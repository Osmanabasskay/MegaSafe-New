import type { SupportedPaymentMethod } from './paymentService';
import type { LinkedBankAccountRecord, LinkedMobileMoneyRecord, MobileMoneyNetwork } from '../store/appDataStore';

export const MOBILE_MONEY_METHODS: Array<{
  id: MobileMoneyNetwork;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { id: 'orange_money', label: 'Orange Money', shortLabel: 'Orange', color: '#F97316' },
  { id: 'afrimoney', label: 'AfriMoney', shortLabel: 'Africell', color: '#16A34A' },
  { id: 'qmoney', label: 'QMoney', shortLabel: 'QMoney', color: '#2563EB' },
];

export const PAYMENT_METHOD_LABELS: Record<SupportedPaymentMethod, string> = {
  orange_money: 'Orange Money',
  afrimoney: 'AfriMoney',
  qmoney: 'QMoney',
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  cash_collected: 'Cash Collected',
};

export function getLinkedMobileMoneyAccount(
  accounts: LinkedMobileMoneyRecord[],
  method: SupportedPaymentMethod
): LinkedMobileMoneyRecord | null {
  if (method !== 'orange_money' && method !== 'afrimoney' && method !== 'qmoney') return null;
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
    return params.bankAccounts[0].accountNumberMasked;
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
