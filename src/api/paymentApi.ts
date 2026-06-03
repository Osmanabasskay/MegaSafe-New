/**
 * paymentApi — thin wrappers for payment and contribution operations.
 * All payment decisions, duplicate checks, and receipt generation are server-side.
 */

export {
  initiateGroupPayment,
  getMemberContributionStatus,
  validateMemberEligibility,
  getContributionSchedule,
  fetchPaymentById,
  fetchUserContributions,
  generateIdempotencyKey,
  type InitiateGroupPaymentInput,
  type InitiateGroupPaymentResult,
  type MemberContributionStatus,
  type ScheduleEntry,
  type SupportedPaymentMethod,
  type PaymentProvider,
  type ContributionRow,
} from '../services/paymentService';
