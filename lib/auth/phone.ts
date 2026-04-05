/** Normalize user input to E.164-style (+ and digits only). */
export function normalizePhoneE164(raw: string): string {
  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) s = `+${s}`;
  return s;
}

export function isValidE164(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}
