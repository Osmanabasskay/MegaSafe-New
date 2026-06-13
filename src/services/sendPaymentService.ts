import { z } from 'zod';
import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';
import { logEdgeRequest, readEdgeJson } from './edgeFunctionClient';

export const sendTargetTypeSchema = z.enum(['group', 'savings']);
export type SendTargetType = z.infer<typeof sendTargetTypeSchema>;

export const sendMethodSchema = z.enum(['orange_money', 'afrimoney']);
export type SendPaymentMethod = z.infer<typeof sendMethodSchema>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_UNAVAILABLE = 'Payment unavailable. Please recreate the payment.';
const PAYMENT_SESSION_INVALID = 'Payment session expired. Please recreate the payment.';

const intentPreviewSchema = z.object({
  paymentIntentId: z.string().uuid(),
  status: z.string(),
  targetType: sendTargetTypeSchema,
  targetId: z.string().uuid(),
  targetName: z.string(),
  amount: z.number().positive(),
  currency: z.string().default('NLe'),
  method: sendMethodSchema,
  maskedAccount: z.string(),
  expiresAt: z.string(),
});

const receiptSchema = z.object({
  receiptNumber: z.string(),
  transactionId: z.string().nullable().optional(),
  paymentIntentId: z.string().uuid(),
  status: z.string(),
  timestamp: z.string(),
  amount: z.number().positive(),
  currency: z.string().default('NLe'),
  maskedAccount: z.string(),
  providerReference: z.string().nullable().optional(),
});

export type SendPaymentIntentPreview = z.infer<typeof intentPreviewSchema>;
export type SendReceipt = z.infer<typeof receiptSchema>;
export type SendPaymentCodeResult = {
  providerReference: string | null;
  monimePaymentCodeId: string | null;
  ussdCode: string | null;
  expiresAt: string | null;
  mmTxnId: string | null;
  paymentType: 'osusu_contribution' | 'savings_deposit' | string | null;
};

async function callSendFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
  schema: z.ZodSchema<T>
): Promise<{ data: T | null; error: Error | null }> {
  if (!supabaseConfigured) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Not authenticated.');

    const supabaseUrl =
      (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
      process.env.EXPO_PUBLIC_SUPABASE_URL ??
      '';

    logEdgeRequest(functionName, body);

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await readEdgeJson(response, functionName);

    return { data: schema.parse(json), error: null };
  } catch (err) {
    return { data: null, error: toBackendError(err, functionName) };
  }
}

export async function createSendPaymentIntent(input: {
  targetType: SendTargetType;
  targetId: string;
  amount?: number;
  method: SendPaymentMethod;
}): Promise<{ intent: SendPaymentIntentPreview | null; error: Error | null }> {
  let targetType: SendTargetType;
  let targetId: string;
  let method: SendPaymentMethod;
  let amount: number | undefined;

  try {
    targetType = sendTargetTypeSchema.parse(input.targetType);
    method = sendMethodSchema.parse(input.method);
    targetId = String(input.targetId ?? '').trim();
    if (!UUID_RE.test(targetId)) {
      return { intent: null, error: new Error('Please choose a destination again.') };
    }
    amount = input.amount == null ? undefined : z.number().positive().max(1_000_000).parse(input.amount);
  } catch (err) {
    return { intent: null, error: toBackendError(err, 'create-send-payment-intent') };
  }

  const body: Record<string, unknown> = {
    action: 'create',
    target_type: targetType,
    target_id: targetId,
    method,
  };
  if (amount !== undefined) body.amount = amount;

  const { data, error } = await callSendFunction('create-send-payment-intent', body, intentPreviewSchema);

  return { intent: data, error };
}

export async function fetchSendPaymentIntent(
  paymentIntentId: string
): Promise<{ intent: SendPaymentIntentPreview | null; error: Error | null }> {
  const parsedId = z.string().uuid().safeParse(paymentIntentId);
  if (!parsedId.success) {
    return { intent: null, error: new Error(PAYMENT_UNAVAILABLE) };
  }

  const id = parsedId.data;
  const { data, error } = await callSendFunction('create-send-payment-intent', {
    action: 'preview',
    payment_intent_id: id,
  }, intentPreviewSchema);

  return { intent: data, error };
}

export async function confirmSendPayment(input: {
  paymentIntentId: string;
  idempotencyKey: string;
  localAuthMethod: 'biometric';
  transactionPin: string;
}): Promise<{ receipt: SendReceipt | null; status: string | null; paymentCode: SendPaymentCodeResult | null; error: Error | null }> {
  const parsedId = z.string().uuid().safeParse(input.paymentIntentId);
  const parsedIdempotencyKey = z.string().uuid().safeParse(input.idempotencyKey);
  if (!parsedId.success || !parsedIdempotencyKey.success) {
    return {
      receipt: null,
      status: null,
      paymentCode: null,
      error: new Error(parsedId.success ? PAYMENT_SESSION_INVALID : PAYMENT_UNAVAILABLE),
    };
  }

  const id = parsedId.data;
  const idem = parsedIdempotencyKey.data;

  const { data, error } = await callSendFunction('confirm-send-payment', {
    payment_intent_id: id,
    idempotency_key: idem,
    local_auth_method: input.localAuthMethod,
    transaction_pin: input.transactionPin,
  }, z.object({
    status: z.string(),
    receipt: receiptSchema.nullable(),
    providerReference: z.string().nullable().optional(),
    monimePaymentCodeId: z.string().nullable().optional(),
    ussdCode: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
    mmTxnId: z.string().nullable().optional(),
    paymentType: z.string().nullable().optional(),
  }));

  return {
    receipt: data?.receipt ?? null,
    status: data?.status ?? null,
    paymentCode: data?.ussdCode || data?.monimePaymentCodeId
      ? {
          providerReference: data.providerReference ?? null,
          monimePaymentCodeId: data.monimePaymentCodeId ?? null,
          ussdCode: data.ussdCode ?? null,
          expiresAt: data.expiresAt ?? null,
          mmTxnId: data.mmTxnId ?? null,
          paymentType: data.paymentType ?? null,
        }
      : null,
    error,
  };
}
