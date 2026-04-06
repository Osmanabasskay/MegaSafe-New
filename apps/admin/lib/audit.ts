import type { SupabaseClient } from '@supabase/supabase-js';

export const logAdminAction = async (params: {
  supabase: SupabaseClient;
  adminUserId: string;
  targetUserId: string;
  action: string;
  tableName: string;
  targetRecordId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const payload = {
    user_id: params.adminUserId,
    action: params.action,
    table_name: params.tableName,
    record_id: params.targetRecordId ?? params.targetUserId,
    new_values: {
      target_user_id: params.targetUserId,
      reason: params.reason ?? null,
      ...params.metadata,
    },
  };

  await params.supabase.from('audit_logs').insert(payload as never);
};
