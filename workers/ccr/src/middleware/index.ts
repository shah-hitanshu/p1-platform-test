/**
 * Middleware Exports
 *
 * Central export point for all middleware modules.
 */

// Agent Status Check (Phase 7.2)
export { checkAgentStatus } from './agent-status-middleware';

export type { AgentStatusResult } from './agent-status-middleware';

// Authentication Middleware
export {
  hasRealAuthProviders,
  getIdentityProvider,
  getMASClient,
  authenticate,
} from './authentication';

// Mock Authentication (local development only)
export {
  DEFAULT_MOCK_CONFIG,
  getMockIdentityProvider,
  handleAuthRoutes,
} from '../auth/mock-auth';

// Health Check
export { handleHealth } from './health';
export type { HealthResponse } from './health';
