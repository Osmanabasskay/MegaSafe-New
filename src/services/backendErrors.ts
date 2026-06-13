export function logDbError(
  action: string,
  table: string,
  payload: Record<string, unknown>,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Mi Osusu DB Error]', { action, table, payload, message });
}

function readErrorField(error: unknown, key: 'message' | 'details' | 'hint' | 'code'): string | null {
  if (error == null || typeof error !== 'object') return null;

  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getBackendMessage(error: unknown, action: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  const message = readErrorField(error, 'message');
  const details = readErrorField(error, 'details');
  const hint = readErrorField(error, 'hint');
  const code = readErrorField(error, 'code');

  return [message, details, hint, code ? `Code: ${code}` : null]
    .filter(Boolean)
    .join(' ');
}

export function normalizeFinancialErrorMessage(message: string): string | null {
  if (!message) return null;

  if (/transaction[_\s-]?pin.*required|pin.*required/i.test(message)) {
    return 'Enter your Transaction PIN to continue.';
  }

  if (
    /incorrect.*transaction[_\s-]?pin/i.test(message) ||
    /invalid.*transaction[_\s-]?pin/i.test(message) ||
    /transaction[_\s-]?pin.*incorrect/i.test(message) ||
    /transaction[_\s-]?pin.*invalid/i.test(message) ||
    /pin_(invalid|incorrect)|invalid_pin|incorrect_pin/i.test(message)
  ) {
    return 'Incorrect Transaction PIN.';
  }

  if (/insufficient/i.test(message) && /(balance|fund|vault)/i.test(message)) {
    return 'Insufficient vault balance. Your Vault has insufficient balance.';
  }

  if (/invalid target id|invalid destination/i.test(message)) {
    return 'Please choose a destination again.';
  }

  if (
    /provider.*unavailable|payment provider unavailable|monime unavailable|service temporarily unavailable/i.test(message) ||
    /network request failed|network timeout|timed out|fetch failed|failed to fetch|aborterror/i.test(message) ||
    (/invalid provider|unsupported provider|no monime provider/i.test(message) && !/qmoney/i.test(message))
  ) {
    return 'Payment service is temporarily unavailable. Please try again later.';
  }

  if (
    /internal server error|internal error/i.test(message) ||
    /json parse error|unexpected character|unexpected token|malformed json|non-json|unexpected server response/i.test(message)
  ) {
    return 'We could not process your request at the moment. Please try again shortly.';
  }

  return null;
}

export function toBackendError(error: unknown, action: string): Error {
  const rawMessage = getBackendMessage(error, action);
  const message =
    rawMessage && !(error instanceof Error) && typeof error !== 'string'
      ? `${action} failed: ${rawMessage}`
      : rawMessage || `Unable to ${action}.`;

  if (
    /does not exist/i.test(message) ||
    /schema cache/i.test(message) ||
    /Could not find .*function/i.test(message) ||
    /Could not find .*column/i.test(message) ||
    /function .* not found/i.test(message) ||
    /column .* not found/i.test(message) ||
    /PGRST202/i.test(message) ||
    /404/i.test(message)
  ) {
    return new Error(
      `${action} failed because the Mi Osusu Supabase schema is missing one or more required tables, columns, or RPC functions. Apply the latest Supabase migrations, then retry.`
    );
  }

  if (/bucket/i.test(message) && /not found/i.test(message)) {
    return new Error(
      `${action} failed because the required Supabase storage bucket is missing. Run supabase/phase2_storage.sql, then retry.`
    );
  }

  // Foreign-key violation when the user's profile row is missing.
  // Typically triggered when creating a group before the profile trigger
  // has provisioned the row, or when the bootstrap SQL hasn't been run.
  if (
    /violates foreign key/i.test(message) ||
    /foreign key constraint/i.test(message) ||
    /not present in table/i.test(message) ||
    (/profiles/i.test(message) && /insert|update|violat/i.test(message))
  ) {
    return new Error(
      `${action} failed because your user profile hasn't been set up yet. ` +
        'Please sign out, sign back in, and try again. If the problem persists, ' +
        'ask your admin to run supabase/phase3_profile_bootstrap.sql.'
    );
  }

  // RLS recursion / stack depth — caused by non-SECURITY DEFINER helper fns.
  if (
    /stack depth limit exceeded/i.test(message) ||
    /infinite recursion/i.test(message) ||
    /row-level security/i.test(message) ||
    (/policy/i.test(message) && !/foreign key/i.test(message))
  ) {
    return new Error(
      `${action} was blocked by a security policy. Please sign out, sign back in, and try again.`
    );
  }

  // Enum type mismatch — e.g. TEXT sent where contribution_frequency expected.
  if (
    /is of type .* but expression is of type/i.test(message) ||
    /invalid input value for enum/i.test(message)
  ) {
    return new Error(
      `${action} failed due to an invalid option value. ` +
        'Please check that frequency, status, or category fields use exact lowercase values (e.g. "daily", "weekly", "monthly").'
    );
  }

  const financialMessage = normalizeFinancialErrorMessage(message);
  if (financialMessage) {
    return new Error(financialMessage);
  }

  return new Error(message);
}
