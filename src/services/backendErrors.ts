export function logDbError(
  action: string,
  table: string,
  payload: Record<string, unknown>,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Mi Osusu DB Error]', { action, table, payload, message });
}

export function toBackendError(error: unknown, action: string): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : `Unable to ${action}.`;

  if (
    /does not exist/i.test(message) ||
    /schema cache/i.test(message) ||
    /Could not find .*column/i.test(message) ||
    /column .* not found/i.test(message) ||
    /404/i.test(message)
  ) {
    return new Error(
      `${action} failed because the Mi Osusu Supabase schema is missing one or more required tables or columns. Run supabase/core_platform_bootstrap.sql in the Supabase SQL Editor, then retry. If the core script was already run before, also run supabase/osusu_management_migration.sql to repair older deployments.`
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

  return new Error(message);
}
