const FALLBACK_FIRST_NAME = 'Member';

const collapseWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ');
const toKey = (value: string): string => collapseWhitespace(value).replace(/\s+/g, '').toLowerCase();

export const normalizeProfileName = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return '';
  return collapseWhitespace(value);
};

export const isPlaceholderProfileName = (value: string | null | undefined): boolean => {
  const normalized = normalizeProfileName(value);
  if (!normalized) return true;
  const key = toKey(normalized);
  return key === 'member' || key === 'miosusu' || key === 'miosusumember';
};

const capitalizeWords = (value: string): string =>
  value
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');

export const getCredentialDisplayName = (
  email: string | null | undefined,
  phone: string | null | undefined
): string => {
  if (typeof email === 'string' && email.trim()) {
    const local = email.split('@')[0]?.trim() ?? '';
    const cleaned = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) return capitalizeWords(cleaned);
  }
  if (typeof phone === 'string' && phone.trim()) return phone.trim();
  return FALLBACK_FIRST_NAME;
};

export const getProfileFirstName = (
  value: string | null | undefined,
  fallbackName?: string | null
): string => {
  const normalized = normalizeProfileName(value);
  const source = isPlaceholderProfileName(normalized)
    ? normalizeProfileName(fallbackName)
    : normalized;
  if (!source) return FALLBACK_FIRST_NAME;
  const [firstName] = source.split(' ');
  return firstName || FALLBACK_FIRST_NAME;
};

export const getProfileInitials = (
  value: string | null | undefined,
  fallbackName?: string | null
): string => {
  const normalized = normalizeProfileName(value);
  const source = isPlaceholderProfileName(normalized)
    ? normalizeProfileName(fallbackName)
    : normalized;
  if (!source) return 'MS';
  return source
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? '')
    .join('');
};
