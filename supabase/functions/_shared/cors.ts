/**
 * Build CORS headers for a given request Origin.
 *
 * ALLOWED_ORIGIN env var (set via Supabase Dashboard → Edge Functions → Secrets):
 *   - Comma-separated list of exact origins: "https://app.miosusu.sl,miosusu://"
 *   - Leave unset in development ONLY — defaults to '*' with a loud warning.
 *   - Webhook-only functions (mobile-money-webhook, vault-webhook) do NOT use
 *     CORS at all — Monime sends server-to-server POST requests, not browser calls.
 *
 * If the request Origin is not in the allowlist, CORS headers are omitted so
 * the browser blocks the cross-origin response.
 */

const ALLOWED_ORIGINS: Set<string> | null = (() => {
  const raw = Deno.env.get('ALLOWED_ORIGIN')?.trim() ?? '';
  if (!raw) {
    console.warn('[cors] ALLOWED_ORIGIN is not set — defaulting to wildcard (*). Set this in production!');
    return null; // null means wildcard mode (development fallback only)
  }
  return new Set(raw.split(',').map(o => o.trim()).filter(Boolean));
})();

function resolveOrigin(requestOrigin: string | null): string {
  if (!ALLOWED_ORIGINS) return '*'; // wildcard fallback when env var unset
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin;
  return ''; // origin not allowed — omit header so browser blocks the response
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = resolveOrigin(req.headers.get('Origin'));
  if (!origin) return {}; // unlisted origin — no CORS headers
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...(origin !== '*' ? { 'Vary': 'Origin' } : {}),
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }
  return null;
}

/**
 * Static CORS headers for use in non-request-aware contexts.
 *
 * Behaviour:
 *   - ALLOWED_ORIGIN not set   → '*' (dev fallback only — see warning above)
 *   - ALLOWED_ORIGIN=one       → that exact origin
 *   - ALLOWED_ORIGIN=a,b,...   → no Access-Control-Allow-Origin header emitted
 *                                (browsers block; callers MUST use getCorsHeaders(req))
 *
 * For multi-origin production, every error/success Response must use
 * getCorsHeaders(req) so the correct per-request origin is echoed back.
 */
function buildStaticCorsHeaders(): Record<string, string> {
  const base = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (!ALLOWED_ORIGINS) {
    // Development wildcard fallback only.
    return { ...base, 'Access-Control-Allow-Origin': '*' };
  }

  if (ALLOWED_ORIGINS.size === 1) {
    const single = [...ALLOWED_ORIGINS][0]!;
    return { ...base, 'Access-Control-Allow-Origin': single, 'Vary': 'Origin' };
  }

  // Multiple allowed origins: do NOT emit a wildcard — that would bypass the
  // per-origin allowlist. Edge functions using corsHeaders in error responses
  // must switch to getCorsHeaders(req) or the browser will block them.
  console.warn('[cors] Multiple ALLOWED_ORIGIN values — static corsHeaders omits Access-Control-Allow-Origin. Migrate all Response builders to getCorsHeaders(req).');
  return base;
}

export const corsHeaders = buildStaticCorsHeaders();

// ── Request body size guard (Rule 21) ─────────────────────────────────────────

const DEFAULT_MAX_BODY_BYTES = 64 * 1024; // 64 KB — enough for any legitimate API payload

/**
 * Read the request body, enforcing a size limit to prevent resource-exhaustion
 * (A13). Checks Content-Length first (fast path), then reads and re-checks the
 * actual byte count.
 *
 * Returns `{ text, error }`.  When `error` is non-null, callers should return
 * a 413 response immediately.
 */
export async function readBoundedBody(
  req: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<{ text: string; error: string | null }> {
  const cl = Number(req.headers.get('content-length') ?? 0);
  if (cl > maxBytes) {
    return { text: '', error: `Request body too large (max ${maxBytes} bytes).` };
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    return { text: '', error: `Request body too large (max ${maxBytes} bytes).` };
  }
  return { text, error: null };
}
