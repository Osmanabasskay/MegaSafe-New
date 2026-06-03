/**
 * collectorApi — thin wrappers for collector operations.
 * All collection logic, passcode validation, and overlap detection are server-side.
 */

export {
  recordPhysicalCollection,
  assignCollector,
  deactivateCollector,
  getCollectorReport,
  type RecordCollectionInput,
  type RecordCollectionResult,
  type AssignCollectorInput,
  type AssignCollectorResult,
} from '../services/collectorService';
