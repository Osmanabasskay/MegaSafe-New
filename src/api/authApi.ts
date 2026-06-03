/**
 * authApi — thin wrappers for authentication and role operations.
 * Never trust JWT metadata for role decisions; always read from DB via RPC.
 */

import { supabase } from '../services/supabase';
import { getMyRole, type MyRole } from '../services/reportService';
import { toBackendError } from '../services/backendErrors';

export type { MyRole };

export async function signIn(
  email: string,
  password: string
): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: toBackendError(err, 'Sign in') };
  }
}

export async function signOut(): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: toBackendError(err, 'Sign out') };
  }
}

export async function sendPasswordResetEmail(
  email: string
): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: toBackendError(err, 'Password reset') };
  }
}

/** Reads role from DB — never from JWT. Use this to gate UI visibility. */
export async function fetchMyRole(): Promise<{
  role: MyRole | null;
  error: Error | null;
}> {
  return getMyRole();
}
