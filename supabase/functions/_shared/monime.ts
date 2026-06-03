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
  | 'payment_code.cancelled';

export interface MonimePaymentCode {
  id:           string;
  status:       MonimePaymentCodeStatus;
  amount:       number;        // minor units (SLE)
  currency:     string;        // "SLE"
  reference:    string;        // our idempotency key echoed back
  providerId:   string;        // m17 or m18
  ussdCode:     string;        // dial string e.g. "*144*5*123456#"
  createdAt:    string;
  expiresAt:    string;
  processedAt?: string | null;
  completedAt?: string | null;
  processedPaymentData?: {
    orderNumber: string;       // stable ID for deduplication across webhook retries
    [key: string]: unknown;
  } | null;
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
}

export interface MonimeProviderKyc {
  accountId:  string;
  providerId: string;
  verified:   boolean;
  name?:      string | null;
  status:     string;
  checkedAt:  string;
}

export interface MonimeWebhookPayload {
  event: MonimeEventType | string;
  data:  Record<string, unknown>;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function monimeBaseUrl(): string {
  return (Deno.env.get('MONIME_BASE_URL') ?? 'https://api.monime.io').replace(/\/$/, '');
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
}): Promise<MonimePaymentCode> {
  const resp = await fetch(`${monimeBaseUrl()}/v1/payment-codes`, {
    method:  'POST',
    headers: buildHeaders(params.idempotencyKey),
    body: JSON.stringify({
      amount:      toMinorUnits(params.amount),
      currency:    'SLE',
      providerId:  params.providerId,
      reference:   params.reference,
      description: params.description,
      webhookUrl:  params.webhookUrl,
      duration:    params.durationSeconds ?? 600,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime createPaymentCode failed (HTTP ${resp.status}): ${errText}`);
  }

  return resp.json() as Promise<MonimePaymentCode>;
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

  return resp.json() as Promise<MonimePaymentCode>;
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
      amount:      toMinorUnits(params.amount),
      currency:    'SLE',
      destination: {
        type:        'momo',
        providerId:  params.providerId,
        phoneNumber: params.phoneNumber,
      },
      reference:   params.reference,
      description: params.description,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Monime createPayout failed (HTTP ${resp.status}): ${errText}`);
  }

  return resp.json() as Promise<MonimePayout>;
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

  return resp.json() as Promise<MonimePayout>;
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

  return resp.json() as Promise<MonimeProviderKyc>;
}

// ── Webhook signature verification ────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature in the `Monime-Signature` header.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * IMPORTANT: Callers MUST return HTTP 200 regardless of this result.
 * Return false → skip processing; do NOT return 4xx/5xx to Monime.
 */
export async function verifyMonimeSignature(
  rawBody:         string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const secret = Deno.env.get('MONIME_WEBHOOK_SECRET');
  if (!secret) {
    console.error('MONIME_WEBHOOK_SECRET is not configured — skipping signature verification.');
    return false;
  }

  const encoder   = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf   = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(rawBody));
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
