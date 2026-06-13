import { normalizeFinancialErrorMessage } from './backendErrors';

type EdgeResponse = Response & {
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

type EdgePayload = Record<string, unknown>;

const GENERIC_UNEXPECTED_RESPONSE =
  'We could not process your request at the moment. Please try again shortly.';

function isRecord(value: unknown): value is EdgePayload {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function shouldLogRawResponses(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function rawPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 700);
}

function logEdgeResponseIssue(
  action: string,
  response: Pick<Response, 'status' | 'headers'>,
  rawBody: string,
  reason: string,
): void {
  if (!shouldLogRawResponses()) return;

  console.warn('[Mi Osusu Edge Response]', {
    action,
    status: response.status,
    contentType: response.headers?.get?.('content-type') ?? null,
    reason,
    rawBody: rawPreview(rawBody),
  });
}

export function logEdgeRequest(action: string, body: Record<string, unknown>): void {
  if (!shouldLogRawResponses()) return;

  const safeBody = Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (/pin|token|authorization|secret|key/i.test(key)) {
        return [key, value ? '[redacted]' : value];
      }
      return [key, value];
    })
  );

  console.warn('[Mi Osusu Edge Request]', {
    action,
    body: safeBody,
  });
}

async function readRawBody(response: EdgeResponse): Promise<string> {
  if (typeof response.text === 'function') {
    return await response.text();
  }

  if (typeof response.json === 'function') {
    const json = await response.json();
    return JSON.stringify(json) ?? '';
  }

  return '';
}

function errorFromPayload(payload: EdgePayload): string | null {
  const error = payload.error ?? payload.message;
  return typeof error === 'string' && error.trim() ? error.trim() : null;
}

function errorCodeFromPayload(payload: EdgePayload): string | null {
  const code = payload.code;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

function toUserSafeError(message: string, fallback = GENERIC_UNEXPECTED_RESPONSE): Error {
  return new Error(normalizeFinancialErrorMessage(message) ?? (message.trim() || fallback));
}

function unwrapPayload(payload: EdgePayload): EdgePayload {
  if (payload.success === true && isRecord(payload.data)) {
    return payload.data;
  }

  return payload;
}

export async function readEdgeJson(response: EdgeResponse, action: string): Promise<EdgePayload> {
  let rawBody = '';

  try {
    rawBody = await readRawBody(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEdgeResponseIssue(action, response, rawBody, `body_read_failed:${message}`);
    throw toUserSafeError(message);
  }

  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    logEdgeResponseIssue(action, response, rawBody, 'invalid_json');
    throw new Error(normalizeFinancialErrorMessage(rawBody) ?? GENERIC_UNEXPECTED_RESPONSE);
  }

  if (!isRecord(parsed)) {
    logEdgeResponseIssue(action, response, rawBody, 'non_object_json');
    throw new Error(GENERIC_UNEXPECTED_RESPONSE);
  }

  const payloadError = errorFromPayload(parsed);
  if (!response.ok || parsed.success === false || payloadError) {
    const code = errorCodeFromPayload(parsed);
    const message = payloadError ?? `Request failed (${response.status})`;
    if (!response.ok || parsed.success === false) {
      logEdgeResponseIssue(action, response, rawBody, code ? `edge_error:${code}` : 'edge_error');
    }
    throw toUserSafeError(message);
  }

  return unwrapPayload(parsed);
}
