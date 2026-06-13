import { createUserClient } from './auth.ts';

export interface TransactionPinResult {
  ok: boolean;
  response?: Response;
}

export async function requireTransactionPin(
  req: Request,
  authHeader: string | null,
  pin: unknown,
  purpose: string,
  context: Record<string, unknown> = {},
  jsonError: (message: string, status?: number) => Response,
): Promise<TransactionPinResult> {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    await auditPinBlock(authHeader, purpose, context);
    return { ok: false, response: jsonError('Transaction PIN is required.', 403) };
  }

  const userClient = createUserClient(authHeader);
  const { data, error } = await userClient.rpc('verify_transaction_pin', {
    p_pin: pin,
    p_purpose: purpose,
    p_transaction_context: context,
  });

  if (error) {
    console.error(`${purpose} transaction PIN verification failed:`, error.message);
    return { ok: false, response: jsonError('Could not verify Transaction PIN.', 500) };
  }

  const result = data as Record<string, unknown> | null;
  if (result?.success === true) return { ok: true };

  const code = typeof result?.code === 'string' ? result.code : null;
  const message = typeof result?.error === 'string' ? result.error : 'Invalid Transaction PIN.';
  const status = code === 'transaction_pin_required' ? 403 : code === 'transaction_pin_locked' ? 423 : 403;
  return { ok: false, response: jsonError(message, status) };
}

async function auditPinBlock(authHeader: string | null, purpose: string, context: Record<string, unknown>) {
  try {
    const userClient = createUserClient(authHeader);
    await userClient.rpc('verify_transaction_pin', {
      p_pin: '',
      p_purpose: purpose,
      p_transaction_context: context,
    });
  } catch {
    // Non-blocking audit attempt only.
  }
}
