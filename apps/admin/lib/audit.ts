import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Risk weighting for admin actions. Higher-impact actions (financial / role /
 * account-status mutations) score higher so insider-fraud review can prioritise.
 * 0-100 scale, same banding as risk_events (see severity_for_score in DB).
 */
const ACTION_RISK_SCORE: Record<string, number> = {
  // account status
  suspend_user: 45,
  unsuspend_user: 25,
  ban_user: 70,
  lock_account: 55,
  unlock_account: 25,
  force_logout: 35,
  // KYC
  approve_kyc: 30,
  reject_kyc: 30,
  mark_kyc_verified: 40,
  request_kyc_resubmission: 20,
  escalate_kyc: 25,
  // finance — highest sensitivity
  approve_withdrawal: 65,
  reject_withdrawal: 40,
  freeze_payout: 60,
  unfreeze_payout: 50,
  freeze_transaction: 60,
  // osusu
  pause_group: 30,
  force_disband_group: 55,
  suspend_collector: 40,
  reinstate_collector: 25,
  // compliance
  resolve_dispute: 20,
  reject_dispute: 20,
  add_admin_note: 10,
  mark_risk_reviewed: 10,
  update_risk_status: 15,
  create_fraud_case: 35,
  update_fraud_case: 20,
  export_generated: 25,
};

export const riskScoreForAction = (action: string): number => ACTION_RISK_SCORE[action] ?? 15;

const isLikelyIp = (ip?: string): boolean => {
  if (!ip || ip === 'unknown') return false;
  // IPv4 or IPv6 (loose) — enough to avoid an inet cast failure on 'unknown'
  return /^[0-9a-fA-F:.]+$/.test(ip) && (ip.includes('.') || ip.includes(':'));
};

/**
 * Logs a super-admin action to the `admin_actions` ledger (Phase 11/12).
 *
 * NOTE: this replaces the previous broken implementation that inserted into
 * `audit_logs` using columns `user_id` / `new_values` (which DO NOT EXIST — the
 * real columns are `actor_id` / `new_data`) and free-text `action` values that
 * are not part of the `audit_action` ENUM. Those inserts were silently rejected,
 * so NO admin action was ever recorded. Admin actions now go to the dedicated
 * `admin_actions` table (free-text action + severity + risk score).
 *
 * Never logs secrets (passwords, OTPs, JWTs, refresh tokens, card data).
 * RLS: super_admin SELECT only; INSERT happens via service-role client.
 */
export const logAdminAction = async (params: {
  supabase:        SupabaseClient;
  adminUserId:     string;
  adminName?:      string;
  targetUserId?:   string;
  action:          string;
  tableName:       string;   // hardcoded by caller, never user-supplied
  targetRecordId?: string;
  reason?:         string;
  ipAddress?:      string;
  status?:         'success' | 'failed';
  metadata?:       Record<string, unknown>;
}): Promise<void> => {
  const ipValid = isLikelyIp(params.ipAddress);
  const { error } = await params.supabase.from('admin_actions').insert({
    admin_user_id:    params.adminUserId,
    admin_name:       params.adminName ?? null,
    action:           params.action,
    target_table:     params.tableName,
    target_user_id:   params.targetUserId ?? null,
    target_record_id: params.targetRecordId ?? params.targetUserId ?? null,
    reason:           params.reason ?? null,
    status:           params.status ?? 'success',
    risk_score:       riskScoreForAction(params.action),
    ip_address:       ipValid ? params.ipAddress : null,
    metadata: {
      ...(ipValid ? {} : { raw_ip: params.ipAddress ?? null }),
      ...params.metadata,
    },
  } as never);

  if (error) {
    // Surface loudly — a failure here means an admin action went unrecorded.
    console.error('[audit] FAILED to write admin_actions ledger:', error.message);
  }
};
