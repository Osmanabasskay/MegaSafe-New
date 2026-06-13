/**
 * providerKyc.ts — backend-only Provider KYC gate for payment initiation.
 *
 * Every Monime payment-code creation passes through ensureProviderKyc() first.
 *
 * Enforcement posture is configurable via the PROVIDER_KYC_ENFORCEMENT env var
 * (see kycEnforcement()). These flows are all money-IN (collections the user
 * authorises on their own phone via USSD + mobile-money PIN), so the default is
 * 'lenient': a Monime Provider KYC outage no longer hard-blocks every top-up,
 * but a number Monime explicitly reports as unregistered is still rejected.
 *
 * Guarantees:
 *   - Raw provider identity data (names, IDs) never leaves the backend;
 *     callers only receive { ok, statusCode, message, status, cached }.
 *   - Results are cached in provider_kyc_checks for 24 h per
 *     (user, provider, phone) to avoid hammering the Monime API.
 *   - Every outcome is audit-logged, including the exact Monime error text on
 *     failures, so the root cause is always recoverable from audit_logs.
 */

import { getProviderKyc } from './monime.ts';
import {
  validateMonimeMethod,
  UNREGISTERED_NUMBER_MESSAGE,
  PROVIDER_KYC_UNAVAILABLE_MESSAGE,
} from './paymentValidation.ts';

/**
 * KYC enforcement posture (PROVIDER_KYC_ENFORCEMENT env):
 *   - 'strict'  : fail-closed. Block whenever the KYC check cannot be completed
 *                 (Monime unavailable / errors).
 *   - 'lenient' : (DEFAULT) fail-open on dependency errors. Allow when the check
 *                 cannot be completed, but still block a number Monime explicitly
 *                 reports as unregistered.
 *   - 'off'     : skip the KYC pre-check entirely.
 */
type KycEnforcement = 'strict' | 'lenient' | 'off';

function kycEnforcement(): KycEnforcement {
  const raw = (Deno.env.get('PROVIDER_KYC_ENFORCEMENT') ?? 'lenient').trim().toLowerCase();
  return raw === 'strict' || raw === 'off' ? raw : 'lenient';
}

/**
 * Monime account IDs are bare MSISDNs without a leading '+'. We store linked
 * numbers in E.164 ('+23277XXXXXX'); strip the '+' (and any stray non-digits)
 * before querying so the provider lookup receives '23277XXXXXX'.
 */
function toMsisdn(phone: string): string {
  return String(phone ?? '').trim().replace(/^\+/, '').replace(/\D/g, '');
}

// Matches createServiceClient() return without importing supabase-js types here.
type ServiceClient = {
  from: (table: string) => any;
};

export interface ProviderKycGateResult {
  ok: boolean;
  /** HTTP status the edge function should return when ok=false. */
  statusCode: number;
  /** Safe, user-facing message. Never contains provider identity data. */
  message: string;
  /** Internal status for logging: verified | not_found | failed | unavailable | unsupported */
  status: string;
  cached: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function ensureProviderKyc(
  svc: ServiceClient,
  params: {
    userId:      string;
    method:      string;       // 'orange_money' | 'afrimoney' | anything else → rejected
    phoneNumber: string;
    flow:        string;       // e.g. 'initiate_payment' | 'vault_topup' | 'send_payment'
  },
): Promise<ProviderKycGateResult> {
  const { userId, method, phoneNumber, flow } = params;
  const mode = kycEnforcement();

  // 0. Pre-check disabled entirely.
  if (mode === 'off') {
    await auditKyc(svc, userId, 'provider_kyc_skipped', { flow, method, mode });
    return { ok: true, statusCode: 200, message: '', status: 'skipped', cached: false };
  }

  // 1. Provider must be supported (QMoney and unknowns rejected with clear copy).
  const provider = validateMonimeMethod(method);
  if (!provider.ok) {
    await auditKyc(svc, userId, 'provider_kyc_unsupported', { flow, method, code: provider.code });
    return { ok: false, statusCode: 400, message: provider.message, status: 'unsupported', cached: false };
  }

  const phone = toMsisdn(phoneNumber);
  if (phone.length < 8) {
    await auditKyc(svc, userId, 'provider_kyc_failed', { flow, method, reason: 'invalid_msisdn' });
    return { ok: false, statusCode: 400, message: UNREGISTERED_NUMBER_MESSAGE, status: 'failed', cached: false };
  }

  // 2. 24-hour cache (provider_kyc_checks is service-role/RLS-protected).
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  try {
    const { data: cached } = await svc
      .from('provider_kyc_checks')
      .select('status, created_at')
      .eq('user_id', userId)
      .eq('provider_id', provider.providerId)
      .eq('account_id', phone)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      const verified = String((cached as Record<string, unknown>).status) === 'verified';
      await auditKyc(svc, userId, 'provider_kyc_cached', { flow, method, verified });
      if (verified) {
        return { ok: true, statusCode: 200, message: '', status: 'verified', cached: true };
      }
      return { ok: false, statusCode: 403, message: UNREGISTERED_NUMBER_MESSAGE, status: 'not_found', cached: true };
    }
  } catch (e) {
    // Cache read problems must not weaken the gate — continue to a live check.
    console.warn('ensureProviderKyc: cache lookup failed:', e instanceof Error ? e.message : e);
  }

  // 3. Live Monime Provider KYC lookup.
  let kyc: Awaited<ReturnType<typeof getProviderKyc>>;
  try {
    kyc = await getProviderKyc(provider.providerId, phone);
  } catch (e) {
    // The check could not be COMPLETED (Monime returned non-2xx or the request
    // failed). Capture the exact error for diagnostics, then apply the posture.
    const detail = e instanceof Error ? e.message : String(e);
    console.error('ensureProviderKyc: Monime KYC API error:', detail);
    if (mode === 'lenient') {
      // Fail-open: a provider-side outage must not block the user's own top-up.
      await auditKyc(svc, userId, 'provider_kyc_unavailable_allowed', { flow, method, error: detail });
      return { ok: true, statusCode: 200, message: '', status: 'unavailable_allowed', cached: false };
    }
    await auditKyc(svc, userId, 'provider_kyc_unavailable', { flow, method, error: detail });
    return { ok: false, statusCode: 502, message: PROVIDER_KYC_UNAVAILABLE_MESSAGE, status: 'unavailable', cached: false };
  }

  const dbStatus = kyc.verified ? 'verified' : (kyc.status === 'not_found' ? 'not_found' : 'failed');

  // 4. Persist server-side (raw identity data stays in raw_response, never returned).
  try {
    await svc.from('provider_kyc_checks').insert({
      user_id:       userId,
      provider_id:   provider.providerId,
      provider_type: 'momo',
      provider_name: provider.method,
      account_id:    phone,
      account_name:  kyc.name ?? null,
      status:        dbStatus,
      raw_response:  kyc as unknown as Record<string, unknown>,
    });
  } catch (e) {
    console.warn('ensureProviderKyc: cache insert failed:', e instanceof Error ? e.message : e);
  }

  if (kyc.verified) {
    await auditKyc(svc, userId, 'provider_kyc_passed', { flow, method });
    return { ok: true, statusCode: 200, message: '', status: 'verified', cached: false };
  }

  await auditKyc(svc, userId, 'provider_kyc_failed', { flow, method, status: dbStatus });
  return { ok: false, statusCode: 403, message: UNREGISTERED_NUMBER_MESSAGE, status: dbStatus, cached: false };
}

async function auditKyc(
  svc: ServiceClient,
  userId: string,
  action: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await svc.from('audit_logs').insert({
      actor_id:   userId,
      action,
      table_name: 'provider_kyc_checks',
      record_id:  null,
      new_data:   data,
    });
  } catch (e) {
    console.warn('ensureProviderKyc: audit insert failed:', e instanceof Error ? e.message : e);
  }
}
