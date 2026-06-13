import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAdminAction, riskScoreForAction } from '@/lib/audit';
import { assertNoSelfAction, consumeAdminRateLimit, getClientIp, isIpAllowed } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const actionSchema = z.object({
  action: z.enum([
    // KYC
    'approve_kyc',
    'reject_kyc',
    'request_kyc_resubmission',
    'mark_kyc_verified',
    'escalate_kyc',
    // account status
    'suspend_user',
    'unsuspend_user',
    'ban_user',
    'lock_account',
    'unlock_account',
    'force_logout',
    'add_admin_note',
    // osusu
    'pause_group',
    'force_disband_group',
    'suspend_collector',
    'reinstate_collector',
    // compliance
    'resolve_dispute',
    'reject_dispute',
    // finance
    'approve_withdrawal',
    'reject_withdrawal',
    'freeze_payout',
    'unfreeze_payout',
    'freeze_transaction',
    'set_transaction_verification_required',
    // risk / fraud
    'mark_risk_reviewed',
    'update_risk_status',
    'create_fraud_case',
    'update_fraud_case',
  ]),
  targetUserId:   z.string().uuid().optional(),
  targetRecordId: z.string().uuid().optional(),
  reason:         z.string().max(2000).optional(),
  newStatus:      z.string().max(40).optional(),
  severity:       z.enum(['low', 'medium', 'high', 'critical', 'extreme']).optional(),
});

type ActionPayload = z.infer<typeof actionSchema>;
type ServiceClient = ReturnType<typeof createServiceClient>;

const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;
const COOKIE_CHUNK_SUFFIX = /\.\d+$/;
const BASE64_PREFIX = 'base64-';

const base64UrlDecode = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '=',
  );
  return Buffer.from(padded, 'base64').toString('utf8');
};

const parseSessionJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return JSON.parse(decodeURIComponent(raw)) as unknown;
  }
};

const accessTokenFromSessionCookie = (request: Request): string | null => {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookiePairs = cookieHeader
    .split(';')
    .map((part) => {
      const separator = part.indexOf('=');
      if (separator === -1) return null;
      return {
        name: decodeURIComponent(part.slice(0, separator).trim()),
        value: part.slice(separator + 1).trim(),
      };
    })
    .filter((cookie): cookie is { name: string; value: string } => Boolean(cookie));

  const authCookies = cookiePairs.filter((cookie) => SUPABASE_AUTH_COOKIE.test(cookie.name));
  const baseName = authCookies[0]?.name.replace(COOKIE_CHUNK_SUFFIX, '');
  if (!baseName) return null;

  const directValue = authCookies.find((cookie) => cookie.name === baseName)?.value;
  const chunkedValue = authCookies
    .filter((cookie) => cookie.name.startsWith(`${baseName}.`))
    .sort((a, b) => Number(a.name.slice(baseName.length + 1)) - Number(b.name.slice(baseName.length + 1)))
    .map((cookie) => cookie.value)
    .join('');

  const rawCookie = directValue || chunkedValue;
  if (!rawCookie) return null;

  const decodedCookie = rawCookie.startsWith(BASE64_PREFIX)
    ? base64UrlDecode(rawCookie.slice(BASE64_PREFIX.length))
    : rawCookie;

  let session: unknown;
  try {
    session = parseSessionJson(decodedCookie);
  } catch {
    return null;
  }
  if (
    typeof session === 'object' &&
    session !== null &&
    'access_token' in session &&
    typeof session.access_token === 'string'
  ) {
    return session.access_token;
  }

  return null;
};

const readPayload = async (request: Request): Promise<Record<string, unknown>> => {
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await request.json()) as Record<string, unknown>;
  const form = await request.formData();
  const out: Record<string, unknown> = {};
  form.forEach((v, k) => { out[k] = String(v); });
  return out;
};

// Actions that target a user account (subject to the self-action guard).
const USER_TARGETED = new Set([
  'approve_kyc', 'reject_kyc', 'request_kyc_resubmission', 'mark_kyc_verified', 'escalate_kyc',
  'suspend_user', 'unsuspend_user', 'ban_user', 'lock_account', 'unlock_account',
  'force_logout', 'add_admin_note',
]);

// Actions where a reason is mandatory (auditable decisions that must be explained).
const REQUIRES_REASON = new Set([
  'reject_kyc',
  'request_kyc_resubmission',
  'escalate_kyc',
  'add_admin_note',
  'suspend_user',
  'ban_user',
  'lock_account',
  'force_logout',
  'reject_dispute',
  'reject_withdrawal',
  'freeze_payout',
  'freeze_transaction',
  'create_fraud_case',
]);

// Actions that also raise a risk_event for the live monitor.
const RISK_EVENT_FOR: Record<string, { type: string; score: number }> = {
  ban_user:           { type: 'admin_ban_user', score: 70 },
  lock_account:       { type: 'admin_lock_account', score: 55 },
  freeze_payout:      { type: 'payout_frozen', score: 60 },
  freeze_transaction: { type: 'transaction_frozen', score: 60 },
  force_logout:       { type: 'admin_force_logout', score: 35 },
};

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent') ?? undefined;

  if (!isIpAllowed(ip)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  if (!await consumeAdminRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  // ── Authentication ──
  const anonClient = await createSupabaseServerClient();
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  // ── Server-side role check from DATABASE (never trust JWT metadata) ──
  const svc = createServiceClient();
  const [{ data: roleRow }, { data: profileRow }] = await Promise.all([
    svc.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').maybeSingle(),
    svc.from('profiles').select('status, first_name, last_name, full_name').eq('id', user.id).maybeSingle(),
  ]);

  if (!roleRow) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  if (profileRow?.status === 'suspended' || profileRow?.status === 'banned') {
    return NextResponse.json({ error: 'Account is suspended.' }, { status: 403 });
  }
  const adminName =
    [profileRow?.first_name, profileRow?.last_name].filter(Boolean).join(' ') ||
    String(profileRow?.full_name ?? '') || 'Super Admin';

  // ── Input validation ──
  const parsed = actionSchema.safeParse(await readPayload(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload: ActionPayload = parsed.data;
  const targetRecordId = payload.targetRecordId ?? payload.targetUserId;
  const nowIso = new Date().toISOString();

  // ── Reason enforcement (server-side; client prompt is not trusted) ──
  if (REQUIRES_REASON.has(payload.action) && !payload.reason?.trim()) {
    return NextResponse.json(
      { error: 'A reason is required for this action.' },
      { status: 400 }
    );
  }

  // ── Self-action guard for user-targeted actions ──
  if (USER_TARGETED.has(payload.action) && payload.targetUserId) {
    try {
      assertNoSelfAction(user.id, payload.targetUserId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Self-action is blocked for admin safety.';
      return NextResponse.json({ error: message }, { status: 403 });
    }
  }

  // ── Execute action (all writes through service-role client) ──
  try {
    switch (payload.action) {
      // ── KYC ──
      case 'approve_kyc': {
        const app = await resolveKycApplication(svc, payload);
        if (app?.status === 'retake_required') {
          throw new Error('Cannot approve a KYC application that requires a fresh selfie.');
        }
        // Set kyc_verified=true here, same as mark_kyc_verified, so isKycVerified()
        // (which reads kyc_verified, not kyc_status) correctly allows the user through.
        await svc.from('profiles').update({
          kyc_status: 'approved',
          kyc_verified: true,
          kyc_verified_at: nowIso,
          kyc_rejection_reason: null,
        }).eq('id', payload.targetUserId);
        if (app) {
          await svc.from('kyc_applications').update({
            status: 'approved',
            reviewed_at: nowIso,
            reviewed_by: user.id,
            rejection_reason: null,
            updated_at: nowIso,
          }).eq('id', app.id);
          await svc.from('kyc_reviews').insert({
            application_id: app.id,
            reviewer_id: user.id,
            action: 'approved',
            note: payload.reason?.trim() || 'Approved by manual review.',
          } as never);
          await writeKycAudit(svc, {
            applicationId: app.id,
            userId: app.user_id,
            actorUserId: user.id,
            eventType: 'manual_review_decision',
            status: 'success',
            reasonCode: 'admin_approved',
            metadata: { action: payload.action },
          });
        }
        break;
      }
      case 'reject_kyc': {
        const app = await resolveKycApplication(svc, payload);
        await svc.from('profiles').update({ kyc_status: 'rejected', kyc_rejection_reason: payload.reason?.trim() || 'KYC rejected by admin.' }).eq('id', payload.targetUserId);
        if (app) {
          await svc.from('kyc_applications').update({
            status: 'rejected',
            reviewed_at: nowIso,
            reviewed_by: user.id,
            rejection_reason: payload.reason?.trim() || 'KYC rejected by admin.',
            updated_at: nowIso,
          }).eq('id', app.id);
          await svc.from('kyc_reviews').insert({
            application_id: app.id,
            reviewer_id: user.id,
            action: 'rejected',
            note: payload.reason?.trim() || 'KYC rejected by admin.',
          } as never);
          await writeKycAudit(svc, {
            applicationId: app.id,
            userId: app.user_id,
            actorUserId: user.id,
            eventType: 'manual_review_decision',
            status: 'success',
            reasonCode: 'admin_rejected',
            metadata: { action: payload.action },
          });
        }
        break;
      }
      case 'request_kyc_resubmission': {
        const app = await resolveKycApplication(svc, payload);
        await svc.from('profiles').update({ kyc_status: 'rejected', kyc_rejection_reason: payload.reason?.trim() ?? null }).eq('id', payload.targetUserId);
        if (app) {
          await svc.from('kyc_applications').update({
            status: 'retake_required',
            reviewed_at: nowIso,
            reviewed_by: user.id,
            rejection_reason: payload.reason?.trim() ?? null,
            updated_at: nowIso,
          }).eq('id', app.id);
          await svc.from('kyc_reviews').insert({
            application_id: app.id,
            reviewer_id: user.id,
            action: 'requested_info',
            note: payload.reason?.trim() || 'Resubmission requested.',
          } as never);
          await writeKycAudit(svc, {
            applicationId: app.id,
            userId: app.user_id,
            actorUserId: user.id,
            eventType: 'retake_requested',
            status: 'warning',
            reasonCode: 'admin_requested_resubmission',
            metadata: { action: payload.action },
          });
        }
        break;
      }
      case 'mark_kyc_verified': {
        const app = await resolveKycApplication(svc, payload);
        if (app?.status === 'retake_required') {
          throw new Error('Cannot verify a KYC application that requires a fresh selfie.');
        }
        await svc.from('profiles').update({ kyc_status: 'approved', kyc_verified: true, kyc_verified_at: nowIso, kyc_rejection_reason: null }).eq('id', payload.targetUserId);
        if (app) {
          await svc.from('kyc_applications').update({
            status: 'approved',
            reviewed_at: nowIso,
            reviewed_by: user.id,
            rejection_reason: null,
            updated_at: nowIso,
          }).eq('id', app.id);
          await svc.from('kyc_reviews').insert({
            application_id: app.id,
            reviewer_id: user.id,
            action: 'approved',
            note: payload.reason?.trim() || 'Marked verified by manual review.',
          } as never);
          await writeKycAudit(svc, {
            applicationId: app.id,
            userId: app.user_id,
            actorUserId: user.id,
            eventType: 'manual_review_decision',
            status: 'success',
            reasonCode: 'admin_marked_verified',
            metadata: { action: payload.action },
          });
        }
        break;
      }
      case 'escalate_kyc': {
        const app = await resolveKycApplication(svc, payload);
        // keep document for manual review; flag via risk event below
        await svc.from('profiles').update({ kyc_status: 'submitted' }).eq('id', payload.targetUserId);
        if (app) {
          await svc.from('kyc_applications').update({
            status: 'manual_review',
            manual_review_reason: payload.reason?.trim() || 'Escalated by admin.',
            updated_at: nowIso,
          }).eq('id', app.id);
          await writeKycAudit(svc, {
            applicationId: app.id,
            userId: app.user_id,
            actorUserId: user.id,
            eventType: 'manual_review_queued',
            status: 'warning',
            reasonCode: 'admin_escalated',
            metadata: { action: payload.action },
          });
        }
        break;
      }

      // ── Account status ──
      case 'suspend_user':
        await svc.from('profiles').update({ status: 'suspended', is_active: false }).eq('id', payload.targetUserId);
        break;
      case 'unsuspend_user':
        await svc.from('profiles').update({ status: 'active', is_active: true }).eq('id', payload.targetUserId);
        break;
      case 'ban_user':
        await svc.from('profiles').update({ status: 'banned', is_active: false }).eq('id', payload.targetUserId);
        break;
      case 'lock_account':
        await svc.from('profiles').update({ status: 'locked', is_active: false }).eq('id', payload.targetUserId);
        break;
      case 'unlock_account':
        await svc.from('profiles').update({ status: 'active', is_active: true }).eq('id', payload.targetUserId);
        break;
      case 'force_logout':
        // revoke tracked device sessions; real GoTrue revocation is a follow-up edge step
        await svc.from('device_sessions').update({ revoked_at: nowIso, revoked_by: user.id }).eq('user_id', payload.targetUserId).is('revoked_at', null);
        await svc.rpc('log_security_event', {
          p_event_type: 'session_revoked', p_user_id: payload.targetUserId, p_severity: 'medium',
          p_reason: payload.reason?.trim() ?? 'Forced logout by admin', p_metadata: { by: user.id },
        });
        break;
      case 'add_admin_note':
        // note is captured in the admin_actions ledger (reason field) — no state change
        break;

      // ── Osusu ──
      case 'pause_group':
        await svc.from('osusu_groups').update({ status: 'paused' }).eq('id', targetRecordId);
        break;
      case 'force_disband_group':
        // group_status enum has no 'disbanded'; 'archived' is the terminal state
        await svc.from('osusu_groups').update({ status: 'archived' }).eq('id', targetRecordId);
        break;
      case 'suspend_collector':
        // FIX: collectors keys on user_id, not profile_id
        await svc.from('collectors').update({ is_active: false }).eq('user_id', payload.targetUserId);
        break;
      case 'reinstate_collector':
        await svc.from('collectors').update({ is_active: true }).eq('user_id', payload.targetUserId);
        break;

      // ── Compliance ──
      case 'resolve_dispute':
        await svc.from('disputes').update({ status: 'resolved', resolution_note: payload.reason?.trim() || 'Resolved by admin.', resolved_at: nowIso }).eq('id', targetRecordId);
        break;
      case 'reject_dispute':
        await svc.from('disputes').update({ status: 'rejected', resolution_note: payload.reason?.trim() || 'Rejected by admin.' }).eq('id', targetRecordId);
        break;

      // ── Finance ──
      case 'approve_withdrawal': {
        // Delegate to the approve-withdrawal Edge Function which:
        //   (1) calls the approve_withdrawal_request RPC (DB update + balance debit),
        //   (2) initiates the Monime / Flutterwave payout disbursement,
        //   (3) records the payout result and notifies the user.
        // A direct DB update here would mark the withdrawal "approved" without
        // actually sending the funds — a silent business logic gap.
        const accessToken = accessTokenFromSessionCookie(request);
        if (!accessToken) throw new Error('Could not retrieve admin session token for withdrawal approval.');

        const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/approve-withdrawal`;
        const fnRes = await fetch(fnUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body:    JSON.stringify({ withdrawal_id: targetRecordId }),
        });
        if (!fnRes.ok) {
          const fnBody = await fnRes.text().catch(() => fnRes.statusText);
          throw new Error(`approve-withdrawal function returned ${fnRes.status}: ${fnBody}`);
        }
        break;
      }
      case 'reject_withdrawal':
        await svc.from('withdrawal_requests').update({ status: 'rejected', reviewed_by: user.id, reviewed_at: nowIso, review_note: payload.reason?.trim() || 'Rejected by admin.' }).eq('id', targetRecordId);
        break;
      case 'freeze_payout':
        await svc.from('withdrawal_requests').update({ payout_status: 'frozen', review_note: payload.reason?.trim() || 'Payout frozen for review.' }).eq('id', targetRecordId);
        break;
      case 'unfreeze_payout':
        await svc.from('withdrawal_requests').update({ payout_status: null }).eq('id', targetRecordId);
        break;
      case 'freeze_transaction':
        // mobile_money_status has no 'frozen'; represent freeze as a risk flag (below)
        break;
      case 'set_transaction_verification_required': {
        const required = payload.newStatus === 'true' || payload.newStatus === 'on' || payload.newStatus === 'required';
        const { error } = await svc.rpc('set_transaction_verification_required', {
          p_required: required,
        });
        if (error) throw new Error(error.message);
        break;
      }

      // ── Risk / fraud ──
      case 'mark_risk_reviewed':
        await svc.from('risk_events').update({ status: 'resolved', reviewed_by: user.id, reviewed_at: nowIso }).eq('id', targetRecordId);
        break;
      case 'update_risk_status': {
        const next = ['open', 'investigating', 'resolved', 'false_positive'].includes(payload.newStatus ?? '') ? payload.newStatus : 'investigating';
        await svc.from('risk_events').update({ status: next, reviewed_by: user.id, reviewed_at: nowIso }).eq('id', targetRecordId);
        break;
      }
      case 'create_fraud_case':
        await svc.from('fraud_cases').insert({
          title: payload.reason?.trim()?.slice(0, 200) || 'Fraud case opened by admin',
          description: payload.reason?.trim() ?? null,
          severity: payload.severity ?? 'high',
          subject_user_id: payload.targetUserId ?? null,
          related_record_id: payload.targetRecordId ?? null,
          opened_by: user.id,
        } as never);
        break;
      case 'update_fraud_case': {
        const next = ['open', 'investigating', 'escalated', 'resolved', 'false_positive'].includes(payload.newStatus ?? '') ? payload.newStatus : 'investigating';
        const patch: Record<string, unknown> = { status: next, updated_at: nowIso };
        if (payload.reason) patch.resolution_note = payload.reason.trim();
        if (next === 'resolved' || next === 'false_positive') patch.resolved_at = nowIso;
        await svc.from('fraud_cases').update(patch as never).eq('id', targetRecordId);
        break;
      }
    }
  } catch (err) {
    await logAdminAction({
      supabase: svc, adminUserId: user.id, adminName, targetUserId: payload.targetUserId,
      tableName: resolveTableName(payload.action), action: payload.action, targetRecordId,
      reason: payload.reason, ipAddress: ip, status: 'failed',
      metadata: { error: String(err), userAgent },
    });
    return NextResponse.json({ error: 'Action failed.' }, { status: 500 });
  }

  // ── Raise a risk_event for high-severity admin actions ──
  const re = RISK_EVENT_FOR[payload.action];
  if (re) {
    await svc.rpc('record_risk_event', {
      p_event_type: re.type,
      p_risk_score: re.score,
      p_reason: payload.reason?.trim() ?? `${payload.action} by admin`,
      p_actor_user_id: user.id,
      p_target_user_id: payload.targetUserId ?? null,
      p_related_table: resolveTableName(payload.action),
      p_related_record_id: targetRecordId ?? null,
      p_metadata: { admin_action: payload.action },
    });
  }

  // ── Audit log every action (admin_actions ledger) ──
  await logAdminAction({
    supabase: svc, adminUserId: user.id, adminName, targetUserId: payload.targetUserId,
    tableName: resolveTableName(payload.action), action: payload.action, targetRecordId,
    reason: payload.reason, ipAddress: ip, status: 'success',
    metadata: { userAgent, riskScore: riskScoreForAction(payload.action) },
  });

  // Redirect back to same-origin referer only.
  // If NEXT_PUBLIC_ADMIN_URL is not configured, skip redirect entirely (fail closed —
  // never redirect to an unknown or attacker-controlled origin).
  const adminOrigin = (() => {
    try {
      return process.env.NEXT_PUBLIC_ADMIN_URL
        ? new URL(process.env.NEXT_PUBLIC_ADMIN_URL).origin
        : null;
    } catch {
      return null;
    }
  })();

  if (adminOrigin) {
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refUrl = new URL(referer);
        if (refUrl.origin === adminOrigin) {
          return NextResponse.redirect(referer, { status: 303 });
        }
      } catch {
        // Malformed Referer — fall through to JSON response
      }
    }
  }
  return NextResponse.json({ ok: true });
}

function resolveTableName(action: string): string {
  if (['approve_kyc', 'reject_kyc', 'request_kyc_resubmission', 'mark_kyc_verified', 'escalate_kyc', 'suspend_user', 'unsuspend_user', 'ban_user', 'lock_account', 'unlock_account', 'force_logout', 'add_admin_note'].includes(action)) return 'profiles';
  if (['pause_group', 'force_disband_group'].includes(action)) return 'osusu_groups';
  if (['suspend_collector', 'reinstate_collector'].includes(action)) return 'collectors';
  if (['resolve_dispute', 'reject_dispute'].includes(action)) return 'disputes';
  if (['approve_withdrawal', 'reject_withdrawal', 'freeze_payout', 'unfreeze_payout'].includes(action)) return 'withdrawal_requests';
  if (['freeze_transaction'].includes(action)) return 'mobile_money_transactions';
  if (['set_transaction_verification_required'].includes(action)) return 'platform_settings';
  if (['mark_risk_reviewed', 'update_risk_status'].includes(action)) return 'risk_events';
  if (['create_fraud_case', 'update_fraud_case'].includes(action)) return 'fraud_cases';
  return 'admin_actions';
}

async function resolveKycApplication(svc: ServiceClient, payload: ActionPayload): Promise<{
  id: string;
  user_id: string;
  status: string;
} | null> {
  if (payload.targetRecordId) {
    const { data } = await svc
      .from('kyc_applications')
      .select('id,user_id,status')
      .eq('id', payload.targetRecordId)
      .maybeSingle();
    return data
      ? { id: String(data.id), user_id: String(data.user_id), status: String(data.status ?? '') }
      : null;
  }

  if (!payload.targetUserId) return null;

  const { data } = await svc
    .from('kyc_applications')
    .select('id,user_id,status')
    .eq('user_id', payload.targetUserId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data
    ? { id: String(data.id), user_id: String(data.user_id), status: String(data.status ?? '') }
    : null;
}

async function writeKycAudit(svc: ServiceClient, params: {
  applicationId: string;
  userId: string;
  actorUserId: string;
  eventType: string;
  status: 'success' | 'failed' | 'warning' | 'info';
  reasonCode: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await svc.rpc('record_kyc_audit_event', {
    p_application_id: params.applicationId,
    p_user_id: params.userId,
    p_event_type: params.eventType,
    p_status: params.status,
    p_reason_code: params.reasonCode,
    p_metadata: params.metadata ?? {},
    p_actor_user_id: params.actorUserId,
  });
  if (error) {
    console.error('[admin/action] failed to write KYC audit event:', error.message);
  }
}
