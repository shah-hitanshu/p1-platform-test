import type { DocumentSessionEnv } from './document-session-types';

export interface InternalApiConfig {
  url: string;
  secret: string;
}

/** The internal HTTP API the session syncs through, or undefined when the lane has none. */
export function internalApiConfig(env: DocumentSessionEnv): InternalApiConfig | undefined {
  if (env.INTERNAL_API_URL === undefined || env.INTERNAL_SECRET === undefined) {
    return undefined;
  }
  return { url: env.INTERNAL_API_URL, secret: env.INTERNAL_SECRET };
}
