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
  GoogleIdentityProvider,
  type GoogleIdentityProviderOptions,
} from './google-identity-provider';

export {
  Auth0IdentityProvider,
  type Auth0IdentityProviderOptions,
} from './auth0-identity-provider';
