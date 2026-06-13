import type { SupportedPaymentMethod } from './paymentService';
import type { LinkedBankAccountRecord, LinkedMobileMoneyRecord, MobileMoneyNetwork } from '../store/appDataStore';
import { MOBILE_MONEY_PROVIDER_CONFIG } from './mobileMoneyConfig';

export const MOBILE_MONEY_METHODS: Array<{
  id: MobileMoneyNetwork;
  label: string;
  shortLabel: string;
  color: string;
}> = MOBILE_MONEY_PROVIDER_CONFIG.map((provider) => ({
  id: provider.id,
  label: provider.label,
  shortLabel: provider.shortLabel,
  color: provider.color,
}));

export const PAYMENT_METHOD_LABELS: Record<SupportedPaymentMethod, string> = {
  orange_money: MOBILE_MONEY_PROVIDER_CONFIG.find((provider) => provider.id === 'orange_money')?.label ?? 'Orange Money',
  afrimoney: MOBILE_MONEY_PROVIDER_CONFIG.find((provider) => provider.id === 'afrimoney')?.label ?? 'AfriMoney',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  cash_collected: 'Cash Collected',
};

export function getLinkedMobileMoneyAccount(
  accounts: LinkedMobileMoneyRecord[],
  method: SupportedPaymentMethod
): LinkedMobileMoneyRecord | null {
  if (method !== 'orange_money' && method !== 'afrimoney') return null;
  return accounts.find((account) => account.network === method) ?? null;
}

export function isPaymentMethodLinked(params: {
  method: SupportedPaymentMethod;
  mobileMoneyAccounts: LinkedMobileMoneyRecord[];
  bankAccounts: LinkedBankAccountRecord[];
}): boolean {
  if (params.method === 'cash_collected') return true;
  if (params.method === 'bank_transfer') return params.bankAccounts.length > 0;
  if (params.method === 'card') return false;
  return getLinkedMobileMoneyAccount(params.mobileMoneyAccounts, params.method) != null;
}

export function getPaymentMethodDetail(params: {
  method: SupportedPaymentMethod;
  mobileMoneyAccounts: LinkedMobileMoneyRecord[];
  bankAccounts: LinkedBankAccountRecord[];
}): string {
  const mobileAccount = getLinkedMobileMoneyAccount(params.mobileMoneyAccounts, params.method);
  if (mobileAccount) return mobileAccount.phone;
  if (params.method === 'bank_transfer' && params.bankAccounts[0]) {
    const first = params.bankAccounts[0].accountNumberMasked;
    return params.bankAccounts.length > 1
      ? `${first} (+${params.bankAccounts.length - 1} more)`
      : first;
  }
  if (params.method === 'card') return 'Not available';
  return 'Not linked';
}

export function getFirstLinkedPaymentMethod(params: {
  mobileMoneyAccounts: LinkedMobileMoneyRecord[];
  bankAccounts: LinkedBankAccountRecord[];
}): SupportedPaymentMethod | null {
  const mobile = MOBILE_MONEY_METHODS.find((method) =>
    params.mobileMoneyAccounts.some((account) => account.network === method.id)
  );
  if (mobile) return mobile.id;
  if (params.bankAccounts.length > 0) return 'bank_transfer';
  return null;
}
