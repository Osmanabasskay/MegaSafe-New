import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAdminAction } from '@/lib/audit';
import { assertNoSelfAction, isSuperAdminRole } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
  targetUserId: z.string().min(1),
  tableName: z.string().min(1),
  targetRecordId: z.string().optional(),
  reason: z.string().optional(),
  nextRole: z.string().optional(),
});

const readPayload = async (request: Request): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await request.json()) as Record<string, unknown>;
  }

  const form = await request.formData();
  const payload: Record<string, unknown> = {};
  form.forEach((value, key) => {
    payload[key] = String(value);
  });
  return payload;
};

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const role = user.app_metadata?.role ?? user.user_metadata?.role;
  if (!isSuperAdminRole(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = actionSchema.safeParse(await readPayload(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;
  const targetRecordId = payload.targetRecordId ?? payload.targetUserId;

  if (
    ['approve_kyc', 'reject_kyc', 'suspend_user', 'ban_user', 'change_role'].includes(payload.action)
  ) {
    try {
      assertNoSelfAction(user.id, payload.targetUserId);
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 403 });
    }
  }

  if (payload.action === 'approve_kyc') {
    await supabase
      .from('profiles')
      .update({ kyc_status: 'approved', kyc_rejection_reason: null })
      .eq('id', payload.targetUserId);
  }
  if (payload.action === 'reject_kyc') {
    await supabase
      .from('profiles')
      .update({ kyc_status: 'rejected', kyc_rejection_reason: payload.reason ?? 'KYC rejected' })
      .eq('id', payload.targetUserId);
  }
  if (payload.action === 'suspend_user') {
    await supabase.from('profiles').update({ status: 'suspended' }).eq('id', payload.targetUserId);
  }
  if (payload.action === 'ban_user') {
    await supabase.from('profiles').update({ status: 'banned' }).eq('id', payload.targetUserId);
  }
  if (payload.action === 'change_role') {
    const nextRole = payload.nextRole ?? payload.reason ?? 'member';
    await supabase.from('profiles').update({ role: nextRole }).eq('id', payload.targetUserId);
  }
  if (payload.action === 'pause_group') {
    await supabase.from('osusu_groups').update({ status: 'paused' }).eq('id', targetRecordId);
  }
  if (payload.action === 'force_disband_group') {
    await supabase.from('osusu_groups').update({ status: 'disbanded' }).eq('id', targetRecordId);
  }
  if (payload.action === 'suspend_collector') {
    await supabase.from('collectors').update({ status: 'suspended' }).eq('user_id', payload.targetUserId);
  }
  if (payload.action === 'reinstate_collector') {
    await supabase.from('collectors').update({ status: 'active' }).eq('user_id', payload.targetUserId);
  }

  await logAdminAction({
    supabase,
    adminUserId: user.id,
    targetUserId: payload.targetUserId,
    tableName: payload.tableName,
    action: payload.action,
    targetRecordId,
    reason: payload.reason,
    metadata: { nextRole: payload.nextRole ?? null },
  });

  const referer = request.headers.get('referer');
  if (referer) {
    return NextResponse.redirect(referer, { status: 303 });
  }
  return NextResponse.json({ ok: true });
}
