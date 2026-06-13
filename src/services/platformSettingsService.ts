import { supabase, supabaseConfigured } from './supabase';

export const TRANSACTION_VERIFICATION_SETTING_KEY = 'verification_required_for_transactions';

type PlatformSettingRow = {
  value: boolean | { enabled?: boolean } | string | number | null;
};

export interface VaultTopupLimits {
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  monthlyLimit: number;
}

function parseRequiredValue(value: PlatformSettingRow['value']): boolean {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'enabled' in value) {
    return value.enabled !== false;
  }
  return true;
}

export async function fetchTransactionVerificationRequired(): Promise<boolean> {
  if (!supabaseConfigured) return true;

  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', TRANSACTION_VERIFICATION_SETTING_KEY)
    .maybeSingle<PlatformSettingRow>();

  if (error || !data) return true;
  return parseRequiredValue(data.value);
}

export async function fetchVaultTopupLimits(): Promise<VaultTopupLimits> {
  const fallback: VaultTopupLimits = {
    minAmount: 50,
    maxAmount: 100000,
    dailyLimit: 50000,
    monthlyLimit: 500000,
  };

  if (!supabaseConfigured) return fallback;

  const { data, error } = await supabase.rpc('get_vault_topup_limits');
  if (error || !data || typeof data !== 'object') return fallback;

  const row = data as Record<string, unknown>;
  return {
    minAmount: Number(row.min_amount ?? fallback.minAmount),
    maxAmount: Number(row.max_amount ?? fallback.maxAmount),
    dailyLimit: Number(row.daily_limit ?? fallback.dailyLimit),
    monthlyLimit: Number(row.monthly_limit ?? fallback.monthlyLimit),
  };
}
