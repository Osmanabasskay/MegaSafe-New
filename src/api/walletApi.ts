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
  type VaultSummary,
  type VaultTopupMethod,
  type VaultTopupResult,
  type VaultTopupStatusResult,
  type VaultTopupEffectiveStatus,
  type PayOsusuResult,
  type DepositSavingsResult,
} from '../services/vaultService';
