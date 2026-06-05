/**
 * walletApi — thin wrappers for vault/savings wallet operations.
 * Balance is always fetched from the server — never computed client-side.
 */

export {
  getVaultBalance,
  fetchSavingsGoals,
  createSavingsGoal,
  deleteSavingsGoal,
  processSavingsDeposit,
  processSavingsWithdrawal,
  formatSavingsCategory,
  normalizeSavingsCategory,
  type SavingsGoal,
  type SavingsGoalStatus,
  type SavingsGoalCategory,
  type CreateSavingsGoalInput,
} from '../services/savingsService';

export {
  getVaultSummary,
  initiateVaultTopup,
  verifyVaultTopupStatus,
  payOsusuFromVault,
  depositSavingsFromVault,
  requestVaultWithdrawal,
  type VaultSummary,
  type VaultTopupMethod,
  type VaultTopupResult,
  type VaultTopupStatusResult,
  type VaultTopupEffectiveStatus,
  type PayOsusuResult,
  type DepositSavingsResult,
  type VaultWithdrawalProvider,
  type VaultWithdrawalResult,
} from '../services/vaultService';
