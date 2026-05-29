import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAdminAction } from '@/lib/audit';
import { assertNoSelfAction, consumeAdminRateLimit, getClientIp, isIpAllowed } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const VALID_ROLES = ['super_admin', 'group_creator', 'collector', 'member'] as const;
type ValidRole = typeof VALID_ROLES[number];

const actionSchema = z.object({
  action: z.enum([
    'approve_kyc',
    'reject_kyc',
    'suspend_user',
    'ban_user',
    'change_role',
    'pause_group',
    'force_disband_group',
    'suspend_collector',
    'reinstate_collector',
  ]),
  targetUserId:   z.string().uuid(),
  targetRecordId: z.string().uuid().optional(),
  reason:         z.string().max(500).optional(),
  nextRole:       z.enum(VALID_ROLES).optional(),
});

const readPayload = async (request: Request): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await request.json()) as Record<string, unknown>;
  }
  const form = await request.formData();
  const payload: Record<string, unknown> = {};
  form.forEach((value, key) => { payload[key] = String(value); });
  return payload;
};

/** Service-role client for writes — NEVER exposed to the browser. */
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  // ── IP allowlist & rate limit ──────────────────────────────
  const ip = getClientIp(request.headers);

  if (!isIpAllowed(ip)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  if (!await consumeAdminRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  // ── Authentication via cookie session ──────────────────────
  const anonClient = await createSupabaseServerClient();
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  // ── Role check: READ FROM DATABASE, not JWT metadata ────────
  //    JWT metadata can be stale; the DB is the source of truth.
  const svc = createServiceClient();
  const { data: profileRow } = await svc
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profileRow || profileRow.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  if (profileRow.status === 'suspended' || profileRow.status === 'banned') {
    return NextResponse.json({ error: 'Account is suspended.' }, { status: 403 });
  }

  // ── Input validation ───────────────────────────────────────
  const parsed = actionSchema.safeParse(await readPayload(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload       = parsed.data;
  const targetRecordId = payload.targetRecordId ?? payload.targetUserId;

  // Self-action guard for user-targeted actions
  if (['approve_kyc', 'reject_kyc', 'suspend_user', 'ban_user', 'change_role'].includes(payload.action)) {
    try {
      assertNoSelfAction(user.id, payload.targetUserId);
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 403 });
    }
  }

  // ── Execute action (all writes via service-role client) ─────

  if (payload.action === 'approve_kyc') {
    await svc.from('profiles')
      .update({ kyc_status: 'approved', kyc_rejection_reason: null })
      .eq('id', payload.targetUserId);
  }

  if (payload.action === 'reject_kyc') {
    const reason = payload.reason?.trim() || 'KYC rejected by admin.';
    await svc.from('profiles')
      .update({ kyc_status: 'rejected', kyc_rejection_reason: reason })
      .eq('id', payload.targetUserId);
  }

  if (payload.action === 'suspend_user') {
    await svc.from('profiles')
      .update({ status: 'suspended' })
      .eq('id', payload.targetUserId);
  }

  if (payload.action === 'ban_user') {
    await svc.from('profiles')
      .update({ status: 'banned' })
      .eq('id', payload.targetUserId);
  }

  if (payload.action === 'change_role') {
    const nextRole: ValidRole = payload.nextRole ?? 'member';
    await svc.from('profiles')
      .update({ role: nextRole })
      .eq('id', payload.targetUserId);
  }

  if (payload.action === 'pause_group') {
    await svc.from('osusu_groups')
      .update({ status: 'paused' })
      .eq('id', targetRecordId);
  }

  if (payload.action === 'force_disband_group') {
    await svc.from('osusu_groups')
      .update({ status: 'disbanded' })
      .eq('id', targetRecordId);
  }

  if (payload.action === 'suspend_collector') {
    await svc.from('collectors')
      .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivated_by: user.id })
      .eq('profile_id', payload.targetUserId);
  }

  if (payload.action === 'reinstate_collector') {
    await svc.from('collectors')
      .update({ is_active: true, deactivated_at: null, deactivated_by: null })
      .eq('profile_id', payload.targetUserId);
  }

  // ── Audit log via service-role (DB trigger can't be bypassed) ──
  await logAdminAction({
    supabase: svc,
    adminUserId:    user.id,
    targetUserId:   payload.targetUserId,
    tableName:      resolveTableName(payload.action),   // hardcoded, never user-supplied
    action:         payload.action,
    targetRecordId,
    reason:         payload.reason,
    metadata:       { nextRole: payload.nextRole ?? null, ip },
  });

  // Only redirect to same-origin Referer to prevent open-redirect attacks.
  // An attacker-controlled Referer must never cause the admin browser to be
  // sent to an external domain after a privileged action.
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
      // Malformed Referer — ignore and fall through to JSON response.
    }
  }
  return NextResponse.json({ ok: true });
}

/** Returns the actual table name — never uses user-supplied tableName. */
function resolveTableName(action: string): string {
  if (['approve_kyc','reject_kyc','suspend_user','ban_user','change_role'].includes(action)) return 'profiles';
  if (['pause_group','force_disband_group'].includes(action)) return 'osusu_groups';
  if (['suspend_collector','reinstate_collector'].includes(action)) return 'collectors';
  return 'admin_actions';
}
