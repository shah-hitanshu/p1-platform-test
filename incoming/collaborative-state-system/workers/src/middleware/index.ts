/**
 * Middleware Exports
 *
 * Central export point for all middleware modules.
 */

// Agent Status Middleware (Phase 7.2)
export {
  checkAgentStatus,
  parseAgentHeaders,
  createAgentStatusMiddleware,
} from './agent-status-middleware';

export type {
  AgentStatusResult,
  MiddlewareFunction,
} from './agent-status-middleware';

// Authentication Middleware
export {
  DEFAULT_MOCK_CONFIG,
  hasRealAuthProviders,
  getIdentityProvider,
  getMASClient,
  authenticate,
  getMockIdentityProvider,
  handleAuthRoutes,
} from './authentication';

// Health Check
export { handleHealth } from './health';
export type { HealthResponse } from './health';
