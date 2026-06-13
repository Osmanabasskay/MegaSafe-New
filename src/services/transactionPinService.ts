import { z } from 'zod';
import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';

const pinSchema = z.string().regex(/^\d{4}$/, 'Transaction PIN must be exactly 4 digits.');

export interface TransactionPinStatus {
  isSet: boolean;
  pinSetAt: string | null;
  lockedUntil: string | null;
  resetRequired: boolean;
}

function parseResult(data: unknown) {
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.error) throw new Error(String(result.error));
  return result;
}

export async function getTransactionPinStatus(): Promise<{ status: TransactionPinStatus | null; error: Error | null }> {
  if (!supabaseConfigured) return { status: { isSet: false, pinSetAt: null, lockedUntil: null, resetRequired: false }, error: null };

  try {
    const { data, error } = await supabase.rpc('get_transaction_pin_status');
    if (error) throw error;
    const result = parseResult(data);
    return {
      status: {
        isSet: Boolean(result.is_set),
        pinSetAt: (result.pin_set_at as string | null) ?? null,
        lockedUntil: (result.locked_until as string | null) ?? null,
        resetRequired: Boolean(result.reset_required),
      },
      error: null,
    };
  } catch (err) {
    return { status: null, error: toBackendError(err, 'Get Transaction PIN status') };
  }
}

export async function createTransactionPin(pin: string, confirmPin: string): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured) return { success: false, error: new Error('Service not available.') };

  try {
    pinSchema.parse(pin);
    pinSchema.parse(confirmPin);
    const { data, error } = await supabase.rpc('create_transaction_pin', {
      p_pin: pin,
      p_confirm_pin: confirmPin,
    });
    if (error) throw error;
    parseResult(data);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Create Transaction PIN') };
  }
}

export async function changeTransactionPin(
  currentPin: string,
  newPin: string,
  confirmNewPin: string,
): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured) return { success: false, error: new Error('Service not available.') };

  try {
    pinSchema.parse(currentPin);
    pinSchema.parse(newPin);
    pinSchema.parse(confirmNewPin);
    const { data, error } = await supabase.rpc('change_transaction_pin', {
      p_current_pin: currentPin,
      p_new_pin: newPin,
      p_confirm_new_pin: confirmNewPin,
    });
    if (error) throw error;
    parseResult(data);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Change Transaction PIN') };
  }
}

export async function requestTransactionPinReset(
  method: 'email_otp' | 'phone_otp' = 'email_otp',
): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured) return { success: false, error: new Error('Service not available.') };

  try {
    const { data, error } = await supabase.rpc('request_transaction_pin_reset', { p_method: method });
    if (error) throw error;
    parseResult(data);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Request Transaction PIN reset') };
  }
}

export async function completeTransactionPinReset(
  otpCode: string,
  newPin: string,
  confirmNewPin: string,
): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured) return { success: false, error: new Error('Service not available.') };

  try {
    pinSchema.parse(newPin);
    pinSchema.parse(confirmNewPin);
    const { data, error } = await supabase.rpc('complete_transaction_pin_reset', {
      p_otp_code: otpCode.trim(),
      p_new_pin: newPin,
      p_confirm_new_pin: confirmNewPin,
    });
    if (error) throw error;
    parseResult(data);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Reset Transaction PIN') };
  }
}

export function validateTransactionPinFormat(pin: string): string | null {
  const parsed = pinSchema.safeParse(pin);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Invalid Transaction PIN.';
}
