/**
 * reportApi — thin wrappers for all reporting and summary operations.
 * All aggregations and calculations are server-side via RPCs.
 */

export {
  getHomeSummary,
  getGroupSummary,
  getGroupAdminReport,
  getOutstandingBalances,
  getMyRole,
  type HomeSummary,
  type MyRole,
} from '../services/reportService';
