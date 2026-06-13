/**
 * paymentMethodService — backend-first payment method management.
 *
 * Security rules enforced server-side (SECURITY DEFINER RPCs):
 *  - user_id always derived from auth.uid() — never from caller
 *  - Only 'orange_money' and 'afrimoney' are supported (QMoney is manual-only)
 *  - Phone number normalised and validated server-side to SL E.164
 *  - Methods are activated only by backend RPCs after server validation
 *  - Masked number only is returned to the client (never the raw number)
 *  - Ownership checked before verify/unlink operations
 */

import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';
import {
  isMobileMoneyProvider,
  validateMobileMoneyProviderPhone,
  type MobileMoneyProvider,
} from './mobileMoneyConfig';

export type SupportedProvider = MobileMoneyProvider;

export interface LinkedPaymentMethod {
  id: string;
  provider: SupportedProvider;
  masked_number: string;
  is_verified: boolean;
  is_active: boolean;
  verified_at: string | null;
  created_at: string;
}

export async function linkPaymentMethod(
  provider: SupportedProvider,
  phoneNumber: string,
  transactionPin: string
): Promise<{ success: boolean; methodId?: string; maskedNumber?: string; error: Error | null }> {
  if (!isMobileMoneyProvider(provider)) {
    return {
      success: false,
      error: new Error('Unsupported provider. QMoney is manual collection only.'),
    };
  }

  if (!phoneNumber.trim()) {
    return { success: false, error: new Error('Phone number is required.') };
  }

  const validation = validateMobileMoneyProviderPhone(provider, phoneNumber);
  if (!validation.ok) {
    return { success: false, error: new Error(validation.message) };
  }

  if (!supabaseConfigured) {
    return { success: false, error: new Error('Service not available.') };
  }

  try {
    // user_id is derived server-side from auth.uid() — never passed here
    const { data, error } = await supabase.rpc('link_payment_method', {
      p_provider:     provider,
      p_phone_number: validation.normalizedPhone,
      p_transaction_pin: transactionPin,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      success:       true,
      methodId:      result.method_id as string,
      maskedNumber:  result.masked_number as string,
      error:         null,
    };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Link payment method') };
  }
}

export async function verifyPaymentMethod(
  methodId: string,
  otpCode: string
): Promise<{ success: boolean; isActive?: boolean; error: Error | null }> {
  if (!methodId.trim() || !otpCode.trim()) {
    return { success: false, error: new Error('Method ID and OTP code are required.') };
  }

  if (!supabaseConfigured) {
    return { success: false, error: new Error('Service not available.') };
  }

  try {
    const { data, error } = await supabase.rpc('verify_payment_method', {
      p_method_id: methodId,
      p_otp_code:  otpCode.trim(),
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { success: true, isActive: result.is_active as boolean, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Verify payment method') };
  }
}

export async function getMyPaymentMethods(): Promise<{
  methods: LinkedPaymentMethod[];
  error: Error | null;
}> {
  if (!supabaseConfigured) {
    return { methods: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc('get_my_payment_methods');

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      methods: (result.methods as LinkedPaymentMethod[]) ?? [],
      error:   null,
    };
  } catch (err) {
    return { methods: [], error: toBackendError(err, 'Get payment methods') };
  }
}

export async function unlinkPaymentMethod(
  methodId: string
): Promise<{ success: boolean; error: Error | null }> {
  if (!methodId.trim()) {
    return { success: false, error: new Error('Method ID is required.') };
  }

  if (!supabaseConfigured) {
    return { success: false, error: new Error('Service not available.') };
  }

  try {
    const { data, error } = await supabase.rpc('unlink_payment_method', {
      p_method_id: methodId,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Unlink payment method') };
  }
}
