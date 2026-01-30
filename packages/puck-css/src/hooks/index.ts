/**
 * Hooks barrel export.
 */

export { useAutoSave } from './useAutoSave.js';
export { useDocuments } from './useDocuments.js';
export { useBranches } from './useBranches.js';
export { useCheckpoints } from './useCheckpoints.js';
export { useVersions } from './useVersions.js';
export { useRealtime } from './useRealtime.js';
export type { UseRealtimeParams, UseRealtimeReturn } from './useRealtime.js';

// Presence hooks (Phase 2)
export { usePresence } from './usePresence.js';
export type { UsePresenceOptions, UsePresenceReturn } from './usePresence.js';
export { useBranchPresence } from './useBranchPresence.js';
export type { UseBranchPresenceOptions, UseBranchPresenceReturn } from './useBranchPresence.js';
export { useSitePresence } from './useSitePresence.js';
export type { UseSitePresenceOptions, UseSitePresenceReturn } from './useSitePresence.js';

// Agent Edit hooks (Phase 4)
export { useAgentEdit } from './useAgentEdit.js';
export type {
  UseAgentEditOptions,
  UseAgentEditReturn,
  AgentEditParams,
} from './useAgentEdit.js';
export { useAgentTrigger } from './useAgentTrigger.js';
export type {
  UseAgentTriggerOptions,
  UseAgentTriggerReturn,
  AgentAction,
  AgentTriggerResult,
  AgentTriggerStatus,
} from './useAgentTrigger.js';

// Focus Region Reporting (Phase 3)
export { useFocusRegionReporting } from './useFocusRegionReporting.js';
export type {
  UseFocusRegionReportingOptions,
  UseFocusRegionReportingReturn,
} from './useFocusRegionReporting.js';
