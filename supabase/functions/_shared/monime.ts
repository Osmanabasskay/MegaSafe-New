/**
 * Monime API helpers — Mi Osusu
 *
 * Monime is the mobile-money aggregator for Sierra Leone.
 * Uses the Payment Codes API — users redeem via USSD dial string,
 * NOT a browser checkout URL (the old /checkout/sessions endpoint does not exist).
 *
 * Confirmed provider IDs (per Monime docs):
 *   m17 = Orange Money
 *   m18 = AfriMoney
 *   (m13 / QMoney is NOT confirmed in Monime docs — treat as unsupported)
 *
 * Currency: Monime API uses "SLE" (ISO 4217), amounts in minor units (100 = SLE 1.00).
 * Internal display uses "NLe" — conversion is done here, never on the frontend.
 *
 * Required secrets (set via: supabase secrets set KEY=value):
 *   MONIME_ACCESS_TOKEN   — primary API bearer token
 *   MONIME_SECRET_KEY     — legacy fallback (same credential, older env var name)
 *   MONIME_SPACE_ID       — space identifier, required on every request
 *   MONIME_WEBHOOK_SECRET — HMAC key for verifying webhook signatures
 */

// ── Provider ID mapping ────────────────────────────────────────────────────────

export const MONIME_PROVIDER_IDS: Record<string, string> = {
  orange_money: 'm17',
  afrimoney:    'm18',
  // qmoney (m13) NOT confirmed in Monime docs — reject at initiation, do not add here
};

export const MONIME_SUPPORTED_METHODS = ['orange_money', 'afrimoney'] as const;
export type MonimedSupportedMethod = typeof MONIME_SUPPORTED_METHODS[number];

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonimePaymentCodeStatus =
  | 'pending'    // created, waiting for user to dial
  | 'processed'  // user dialed, payment initiated with provider — orderNumber now available
  | 'completed'  // fully confirmed by provider
  | 'expired'
  | 'cancelled';

export type MonimePayoutStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MonimeEventType =
  | 'payment_code.processed'   // user redeemed — processedPaymentData.orderNumber present
  | 'payment_code.completed'   // payment confirmed end-to-end
  | 'payment_code.expired'
  | 'payment_code.cancelled'
  | 'payout.pending'
  | 'payout.processing'
  | 'payout.completed'
  | 'payout.failed';

export interface MonimePaymentCode {
  id:           string;
  status:       MonimePaymentCodeStatus;
  amount:       number;        // minor units (SLE)
  currency:     string;        // "SLE"
  reference:    string;        // our idempotency key echoed back
  providerId:   string | null; // m17 or m18 when processed/targeted
  ussdCode:     string;        // dial string e.g. "*144*5*123456#"
  createdAt:    string;
  expiresAt:    string;
  processedAt?: string | null;
  completedAt?: string | null;
  processedPaymentData?: {
    orderNumber: string;       // stable ID for deduplication across webhook retries
    [key: string]: unknown;
  } | null;
  metadata?: Record<string, unknown> | null;
}

export interface MonimePayout {
  id:          string;
  status:      MonimePayoutStatus;
  amount:      number;         // minor units (SLE)
  currency:    string;
  reference:   string;
  destination: {
    type:        string;       // "momo"
    providerId:  string;
    phoneNumber: string;
  };
  createdAt:   string;
  completedAt?: string | null;
  failedAt?:    string | null;
  failureCode?: string | null;
  failureMsg?:  string | null;
  metadata?:    Record<string, unknown> | null;
}

export interface MonimeProviderKyc {
  accountId:  string;
  providerId: string;
  verified:   boolean;
  name?:      string | null;
  status:     string;
  checkedAt:  string;
  raw?:        Record<string, unknown>;
}

export interface MonimeWebhookPayload {
  event: MonimeEventType | string;
  data:  Record<string, unknown>;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Monime live API base URL. Override per-environment via MONIME_BASE_URL. */
export const MONIME_LIVE_BASE_URL    = 'https://api.monime.io';
export const MONIME_SANDBOX_BASE_URL = 'https://sandbox.api.monime.io';

/**
 * Resolve the Monime API base URL from environment configuration.
 * Priority:
 *   1. MONIME_BASE_URL          — explicit override (sandbox or live)
 *   2. MONIME_ENV=sandbox       — convenience switch to the sandbox URL
 *   3. live URL                 — default
 * Never expose this (or any Monime credential) to the frontend; only Edge
 * Functions talk to Monime.
 */
function monimeBaseUrl(): string {
  const explicit = Deno.env.get('MONIME_BASE_URL');
  if (explicit && explicit.trim() !== '') return explicit.trim().replace(/\/$/, '');
  const env = (Deno.env.get('MONIME_ENV') ?? '').trim().toLowerCase();
  if (env === 'sandbox' || env === 'test') return MONIME_SANDBOX_BASE_URL;
  return MONIME_LIVE_BASE_URL;
}

/** Prefer MONIME_ACCESS_TOKEN; fall back to legacy MONIME_SECRET_KEY env var name. */
function monimeBearerToken(): string {
  const token = Deno.env.get('MONIME_ACCESS_TOKEN') ?? Deno.env.get('MONIME_SECRET_KEY');
  if (!token) throw new Error('MONIME_ACCESS_TOKEN is not configured. Run: supabase secrets set MONIME_ACCESS_TOKEN=...');
  return token;
}

function monimeSpaceId(): string {
  const id = Deno.env.get('MONIME_SPACE_ID');
  if (!id) throw new Error('MONIME_SPACE_ID is not configured. Run: supabase secrets set MONIME_SPACE_ID=...');
  return id;
}

function buildHeaders(idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Authorization':   `Bearer ${monimeBearerToken()}`,
    'Monime-Space-Id': monimeSpaceId(),
    'Content-Type':    'application/json',
  };
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}

/** NLe display amount → SLE minor units (1 NLe = 100 minor units). */
function toMinorUnits(amountNLe: number): number {
  return Math.round(amountNLe * 100);
}

// ── Payment Codes API ──────────────────────────────────────────────────────────

/**
 * Create a Monime Payment Code.
 * Returns a USSD dial string the user dials to authorise the payment.
 * Duration defaults to 600 s (10 min).
 */
export async function createPaymentCode(params: {
  amount:          number;   // NLe display — converted to SLE minor units internally
  providerId:      string;   // m17 or m18 ONLY
  reference:       string;   // our stable idempotency key
  description:     string;
  webhookUrl:      string;
  idempotencyKey:  string;
  durationSeconds?: number;  // default 600
  phoneNumber?:    string | null;
  metadata?:       Record<string, string>;
}): Promise<MonimePaymentCode> {
  const resp = await fetch(`${monimeBaseUrl()}/v1/payment-codes`, {
    method:  'POST',
    headers: buildHeaders(params.idempotencyKey),
    body: JSON.stringify({
      name:     params.description,
      mode:     'one_time',
      enable:   true,
      amount:   { currency: 'SLE', value: toMinorUnits(params.amount) },
      duration: durationString(params.durationSeconds ?? 600),
      customer: null,
      reference: params.reference,
      authorizedProviders: [params.providerId],
      authorizedPhoneNumber: params.phoneNumber ?? undefined,
      metadata: params.metadata ?? null,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime createPaymentCode failed (HTTP ${resp.status}): ${errText}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  return normalizePaymentCode(json);
}

/**
 * Retrieve a Payment Code by its ID.
 * Always re-verify via this call before crediting the vault — never trust the webhook payload alone.
 */
export async function getPaymentCode(paymentCodeId: string): Promise<MonimePaymentCode> {
  const resp = await fetch(
    `${monimeBaseUrl()}/v1/payment-codes/${encodeURIComponent(paymentCodeId)}`,
    { headers: buildHeaders() },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime getPaymentCode failed (HTTP ${resp.status}): ${errText}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  return normalizePaymentCode(json);
}

function durationString(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 600;
  return `${safeSeconds}s`;
}

function normalizePaymentCode(payload: Record<string, unknown>): MonimePaymentCode {
  const result = ((payload.result && typeof payload.result === 'object') ? payload.result : payload) as Record<string, unknown>;
  const amount = (result.amount && typeof result.amount === 'object') ? result.amount as Record<string, unknown> : {};
  const processed = (result.processedPaymentData && typeof result.processedPaymentData === 'object')
    ? result.processedPaymentData as Record<string, unknown>
    : null;
  const channel = (processed?.channelData && typeof processed.channelData === 'object')
    ? processed.channelData as Record<string, unknown>
    : {};
  const providers = Array.isArray(result.authorizedProviders) ? result.authorizedProviders : [];

  return {
    id: String(result.id ?? ''),
    status: String(result.status ?? 'pending') as MonimePaymentCodeStatus,
    amount: Number(amount.value ?? 0),
    currency: String(amount.currency ?? 'SLE'),
    reference: String(result.reference ?? ''),
    providerId: (channel.providerId ?? providers[0] ?? null) as string | null,
    ussdCode: String(result.ussdCode ?? ''),
    createdAt: String(result.createTime ?? ''),
    expiresAt: String(result.expireTime ?? ''),
    processedAt: null,
    completedAt: null,
    processedPaymentData: processed as MonimePaymentCode['processedPaymentData'],
    metadata: (result.metadata && typeof result.metadata === 'object')
      ? result.metadata as Record<string, unknown>
      : null,
  };
}

/**
 * Cancel a pending Payment Code (e.g. user closes the modal).
 * 404 is treated as a no-op (already expired or cancelled).
 */
export async function cancelPaymentCode(
  paymentCodeId:  string,
  idempotencyKey: string,
): Promise<void> {
  const resp = await fetch(
    `${monimeBaseUrl()}/v1/payment-codes/${encodeURIComponent(paymentCodeId)}/cancel`,
    {
      method:  'POST',
      headers: buildHeaders(idempotencyKey),
      body:    '{}',
    },
  );

  if (!resp.ok && resp.status !== 404) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime cancelPaymentCode failed (HTTP ${resp.status}): ${errText}`);
  }
}

// ── Payouts API ────────────────────────────────────────────────────────────────

/**
 * Create a Monime Payout — disburse funds to a momo wallet.
 * Supported: orange_money (m17), afrimoney (m18).
 * QMoney (m13) is NOT confirmed in Monime docs; callers must reject it before reaching here.
 */
export async function createMonimePayout(params: {
  amount:         number;    // NLe display — converted to SLE minor units internally
  providerId:     string;    // m17 or m18 ONLY
  phoneNumber:    string;
  reference:      string;    // our stable idempotency key
  description:    string;
  idempotencyKey: string;
}): Promise<MonimePayout> {
  const resp = await fetch(`${monimeBaseUrl()}/v1/payouts`, {
    method:  'POST',
    headers: buildHeaders(params.idempotencyKey),
    body: JSON.stringify({
      amount: {
        currency: 'SLE',
        value:    toMinorUnits(params.amount),
      },
      destination: {
        type:        'momo',
        providerId:  params.providerId,
        phoneNumber: params.phoneNumber,
      },
      metadata: {
        reference:   params.reference,
        description: params.description,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime createPayout failed (HTTP ${resp.status}): ${errText}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  return normalizePayout(json);
}

/**
 * Retrieve a Payout by ID (for status polling after initiation).
 */
export async function getMonimePayout(payoutId: string): Promise<MonimePayout> {
  const resp = await fetch(
    `${monimeBaseUrl()}/v1/payouts/${encodeURIComponent(payoutId)}`,
    { headers: buildHeaders() },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime getPayout failed (HTTP ${resp.status}): ${errText}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  return normalizePayout(json);
}

function normalizePayout(payload: Record<string, unknown>): MonimePayout {
  const result = ((payload.result && typeof payload.result === 'object') ? payload.result : payload) as Record<string, unknown>;
  const amount = (result.amount && typeof result.amount === 'object') ? result.amount as Record<string, unknown> : {};
  const destination = (result.destination && typeof result.destination === 'object')
    ? result.destination as Record<string, unknown>
    : {};
  const failure = (result.failureDetail && typeof result.failureDetail === 'object')
    ? result.failureDetail as Record<string, unknown>
    : {};
  const metadata = (result.metadata && typeof result.metadata === 'object')
    ? result.metadata as Record<string, unknown>
    : null;

  return {
    id:        String(result.id ?? ''),
    status:    String(result.status ?? 'pending') as MonimePayoutStatus,
    amount:    Number(amount.value ?? result.amount ?? 0),
    currency:  String(amount.currency ?? result.currency ?? 'SLE'),
    reference: String(metadata?.reference ?? result.reference ?? ''),
    destination: {
      type:        String(destination.type ?? 'momo'),
      providerId:  String(destination.providerId ?? ''),
      phoneNumber: String(destination.phoneNumber ?? ''),
    },
    createdAt:    String(result.createTime ?? result.createdAt ?? ''),
    completedAt:  result.status === 'completed' ? String(result.updateTime ?? '') : null,
    failedAt:     result.status === 'failed' ? String(result.updateTime ?? '') : null,
    failureCode:  failure.code ? String(failure.code) : null,
    failureMsg:   failure.message ? String(failure.message) : null,
    metadata,
  };
}

// ── Provider KYC API ───────────────────────────────────────────────────────────

/**
 * Look up KYC status of a mobile money account.
 * MUST stay backend-only: never send raw KYC data to the frontend,
 * and never trust KYC status supplied by the frontend.
 *
 * @param providerId  m17 or m18
 * @param accountId   MSISDN (phone number) of the account to check
 */
export async function getProviderKyc(
  providerId: string,
  accountId:  string,
): Promise<MonimeProviderKyc> {
  const url  = `${monimeBaseUrl()}/v1/provider-kyc/${encodeURIComponent(providerId)}?accountId=${encodeURIComponent(accountId)}`;
  const resp = await fetch(url, { headers: buildHeaders() });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime getProviderKyc failed (HTTP ${resp.status}): ${errText}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  return normalizeProviderKyc(json, providerId, accountId);
}

function normalizeProviderKyc(
  payload: Record<string, unknown>,
  fallbackProviderId: string,
  fallbackAccountId: string,
): MonimeProviderKyc {
  const result = ((payload.result && typeof payload.result === 'object') ? payload.result : payload) as Record<string, unknown>;
  const account = (result.account && typeof result.account === 'object')
    ? result.account as Record<string, unknown>
    : {};
  const provider = (result.provider && typeof result.provider === 'object')
    ? result.provider as Record<string, unknown>
    : {};

  const resolvedAccountId = String(account.id ?? fallbackAccountId);
  const accountName = (account.holderName ?? account.name ?? null) as string | null;
  const verified = Boolean(account.id || account.holderName || account.name);

  return {
    accountId:  resolvedAccountId,
    providerId: String(provider.id ?? fallbackProviderId),
    verified,
    name:       accountName,
    status:     verified ? 'verified' : 'not_found',
    checkedAt:  new Date().toISOString(),
    raw:        payload,
  };
}

// ── Webhook signature verification ────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature in the `Monime-Signature` header,
 * and enforce timestamp freshness (≤ 300 s) if `Monime-Timestamp` is present.
 *
 * Timestamp header: Monime-Timestamp (Unix seconds, as a string).
 * If the header is absent the signature check still runs; callers should
 * ensure deduplication via payment_webhook_events for replay protection.
 *
 * IMPORTANT: Callers MUST return HTTP 200 regardless of this result.
 * Return false → skip processing; do NOT return 4xx/5xx to Monime.
 */
export async function verifyMonimeSignature(
  rawBody:          string,
  signatureHeader:  string | null,
  timestampHeader?: string | null,
  secretEnvName = 'MONIME_WEBHOOK_SECRET',
): Promise<boolean> {
  if (!signatureHeader) return false;

  const secret = Deno.env.get(secretEnvName) ??
                 (secretEnvName === 'MONIME_WEBHOOK_SECRET'
                   ? undefined
                   : Deno.env.get('MONIME_WEBHOOK_SECRET'));
  if (!secret) {
    console.error(`${secretEnvName} is not configured — skipping signature verification.`);
    return false;
  }

  // ── Timestamp freshness guard (Rule 16) ──────────────────────────────────────
  // Reject events older than 5 minutes to prevent replay attacks.
  // If Monime does not send Monime-Timestamp, this check is skipped but the
  // dedup table (payment_webhook_events) provides the primary replay barrier.
  const FRESHNESS_WINDOW_MS = 300_000; // 5 minutes
  if (timestampHeader != null) {
    const tsMs = Number(timestampHeader) * 1000;
    if (isNaN(tsMs)) {
      console.warn('verifyMonimeSignature: Monime-Timestamp is not a valid number — rejecting.');
      return false;
    }
    const webhookAge = Date.now() - tsMs;
    if (webhookAge > FRESHNESS_WINDOW_MS) {
      console.warn(`verifyMonimeSignature: webhook is ${Math.round(webhookAge / 1000)}s old — rejecting (max 300s).`);
      return false;
    }
    if (webhookAge < -30_000) {
      // Timestamp is more than 30 s in the future — likely a clock skew attack.
      console.warn('verifyMonimeSignature: Monime-Timestamp is in the future — rejecting.');
      return false;
    }
  }

  // ── HMAC-SHA256 constant-time verification ────────────────────────────────────
  // If Monime includes the timestamp in the signed payload (e.g. `ts.body`),
  // adjust the signedPayload construction below accordingly.
  const signedPayload = timestampHeader != null
    ? `${timestampHeader}.${rawBody}`
    : rawBody;

  const encoder   = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf   = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const a = expected;
  const b = signatureHeader;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// ── Event type helpers ─────────────────────────────────────────────────────────

/** User redeemed the code — payment is in-progress; orderNumber is now available. */
export function isProcessedEvent(eventType: string): boolean {
  return eventType === 'payment_code.processed';
}

/** Payment fully confirmed end-to-end. Safe to credit after re-verification. */
export function isCompletedEvent(eventType: string): boolean {
  return eventType === 'payment_code.completed';
}

/** Payment terminal failure (code expired or cancelled). */
export function isFailedEvent(eventType: string): boolean {
  return eventType === 'payment_code.expired' || eventType === 'payment_code.cancelled';
}

/** Any event that indicates payment is moving forward (processed or completed). */
export function isSuccessEvent(eventType: string): boolean {
  return isProcessedEvent(eventType) || isCompletedEvent(eventType);
}

// ── Payout event helpers (payout-webhook) ─────────────────────────────────────

/** Any payout.* lifecycle event. */
export function isPayoutEvent(eventType: string): boolean {
  return eventType.startsWith('payout.');
}

/** Terminal payout success. */
export function isPayoutCompletedEvent(eventType: string): boolean {
  return eventType === 'payout.completed';
}

/** Terminal payout failure (failed / rejected / cancelled). */
export function isPayoutFailedEvent(eventType: string): boolean {
  return eventType === 'payout.failed'
    || eventType === 'payout.rejected'
    || eventType === 'payout.cancelled';
}
