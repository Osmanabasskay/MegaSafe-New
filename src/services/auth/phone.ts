/**
 * phone.ts — Phone normalisation and validation for Mi Osusu.
 *
 * Mi Osusu is Sierra Leone-focused. All phone numbers must be in the
 * Sierra Leone E.164 format: +232 followed by exactly 8 digits.
 *
 * Examples of valid numbers:  +23276123456  +23280123456  +23230123456
 * Examples of invalid numbers: +447911123456  +15555551234  +23276123  +23276123456789
 */

/** Exact E.164 regex for Sierra Leone numbers. */
export const SL_PHONE_REGEX = /^\+232[0-9]{8}$/;

/**
 * Normalise user input to a Sierra Leone E.164 number.
 *
 * Accepts:
 *  - 8 local digits only:      "76123456"  → "+23276123456"
 *  - With leading 0:           "076123456" → "+23276123456" (strips leading 0)
 *  - Full SL number:           "+23276123456" → "+23276123456"
 *  - Full SL without +: "23276123456" → "+23276123456"
 *
 * All non-digit characters (spaces, dashes, parentheses) are stripped first.
 */
export function normalizeToSierraLeone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // User typed the full number including 232
  if (digits.startsWith('232') && digits.length === 11) return `+${digits}`;

  // User typed with a leading 0 (local format 0XXXXXXXX)
  if (digits.startsWith('0') && digits.length === 9) return `+232${digits.slice(1)}`;

  // User typed exactly 8 local digits
  if (digits.length === 8) return `+232${digits}`;

  // Anything else — prepend +232 and let the validator reject if wrong length
  return `+232${digits}`;
}

export function isValidSierraLeonePhone(phone: string): boolean {
  return SL_PHONE_REGEX.test(phone);
}

// ── Legacy helpers (kept for backward compat with non-auth parts of the app) ──

/** @deprecated Use normalizeToSierraLeone for auth flows. */
export function normalizePhoneE164(raw: string): string {
  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) s = `+${s}`;
  return s;
}

/** @deprecated Accepts any E.164 length — use isValidSierraLeonePhone for auth. */
export function isValidE164(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}
