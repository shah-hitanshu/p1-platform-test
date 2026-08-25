/**
 * Authentication Module
 *
 * Exports authentication-related classes and utilities.
 */

export {
  MockIdentityProvider,
  type MockIdentityProviderOptions,
} from './mock-identity-provider';

export {
  MultiProviderIdentityProvider,
  MockIdentityProviderAdapter,
  type IdentityProvider,
} from './identity-provider';

export {
  Auth0IdentityProvider,
  type Auth0IdentityProviderOptions,
} from './auth0-identity-provider';

export {
  AgentApiKeyProvider,
} from './agent-api-key-provider';
