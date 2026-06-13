import { normalizeToSierraLeone, isValidSierraLeonePhone } from './auth/phone';

export const SIERRA_LEONE_DIAL_CODE = '+232';
export const SIERRA_LEONE_FLAG = '🇸🇱';
export const SIERRA_LEONE_LOCAL_NUMBER_LENGTH = 8;

export const MOBILE_MONEY_PROVIDER_CONFIG = [
  {
    id: 'orange_money',
    label: 'Orange Money',
    shortLabel: 'Orange',
    color: '#F97316',
    validPrefixes: ['+23272', '+23273', '+23274', '+23275', '+23276', '+23278', '+23279'],
  },
  {
    id: 'afrimoney',
    label: 'AfriMoney',
    shortLabel: 'Africell',
    color: '#16A34A',
    validPrefixes: ['+23230', '+23233', '+23277', '+23280', '+23288', '+23290', '+23299'],
  },
] as const;

export type MobileMoneyProvider = typeof MOBILE_MONEY_PROVIDER_CONFIG[number]['id'];

export const MOBILE_MONEY_PROVIDER_IDS = MOBILE_MONEY_PROVIDER_CONFIG.map((provider) => provider.id);

export const VAULT_TOPUP_AMOUNT_CONFIG = {
  min: 1,
  max: 100000,
  presets: [5, 10, 50, 100, 500, 1000],
} as const;

export function getMobileMoneyProvider(providerId: string | null | undefined) {
  return MOBILE_MONEY_PROVIDER_CONFIG.find((provider) => provider.id === providerId) ?? null;
}

export function isMobileMoneyProvider(providerId: string | null | undefined): providerId is MobileMoneyProvider {
  return getMobileMoneyProvider(providerId) != null;
}

export function validateMobileMoneyProviderPhone(providerId: MobileMoneyProvider, rawPhone: string): {
  ok: boolean;
  normalizedPhone: string;
  message?: string;
} {
  const normalizedPhone = normalizeToSierraLeone(rawPhone);
  const provider = getMobileMoneyProvider(providerId);

  if (!provider || !isValidSierraLeonePhone(normalizedPhone)) {
    return {
      ok: false,
      normalizedPhone,
      message: 'Enter a valid Sierra Leone mobile money number.',
    };
  }

  const matchesProvider = provider.validPrefixes.some((prefix) => normalizedPhone.startsWith(prefix));
  if (!matchesProvider) {
    return {
      ok: false,
      normalizedPhone,
      message: 'This number does not match the selected mobile money provider.',
    };
  }

  return { ok: true, normalizedPhone };
}
