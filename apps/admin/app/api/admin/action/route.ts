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
      case 'approve_kyc':
        await svc.from('profiles').update({ kyc_status: 'approved', kyc_rejection_reason: null }).eq('id', payload.targetUserId);
        break;
      case 'reject_kyc':
        await svc.from('profiles').update({ kyc_status: 'rejected', kyc_rejection_reason: payload.reason?.trim() || 'KYC rejected by admin.' }).eq('id', payload.targetUserId);
        break;
      case 'request_kyc_resubmission':
        await svc.from('profiles').update({ kyc_status: 'pending', kyc_rejection_reason: payload.reason?.trim() ?? null }).eq('id', payload.targetUserId);
        break;
      case 'mark_kyc_verified':
        await svc.from('profiles').update({ kyc_status: 'approved', kyc_verified: true, kyc_verified_at: nowIso, kyc_rejection_reason: null }).eq('id', payload.targetUserId);
        break;
      case 'escalate_kyc':
        // keep document for manual review; flag via risk event below
        await svc.from('profiles').update({ kyc_status: 'submitted' }).eq('id', payload.targetUserId);
        break;

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
      case 'approve_withdrawal':
        await svc.from('withdrawal_requests').update({ status: 'approved', reviewed_by: user.id, reviewed_at: nowIso }).eq('id', targetRecordId);
        break;
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

  // Redirect back to same-origin referer only
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const adminOrigin = process.env.NEXT_PUBLIC_ADMIN_URL
        ? new URL(process.env.NEXT_PUBLIC_ADMIN_URL).origin
        : null;
      if (adminOrigin && refUrl.origin === adminOrigin) {
        return NextResponse.redirect(referer, { status: 303 });
      }
    } catch {
      // Malformed Referer — fall through
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
  if (['mark_risk_reviewed', 'update_risk_status'].includes(action)) return 'risk_events';
  if (['create_fraud_case', 'update_fraud_case'].includes(action)) return 'fraud_cases';
  return 'admin_actions';
}
