// Shared Cloudflare AI Gateway REST API helpers. Kept dependency-free so both transport
// modules can import it without creating a transport.ts <-> anthropic.ts import cycle.

/**
 * Base of the AI Gateway REST API for an account. The OpenAI SDK appends
 * `/chat/completions` to `${restApiBase}/v1`; the Anthropic SDK appends `/v1/messages`
 * to `${restApiBase}`.
 */
export function restApiBase(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
}

/**
 * Build the `fetch` client option for an SDK constructor: the injected fetcher (used in
 * tests) or nothing in production, where the SDK falls back to global fetch. Spread into
 * the client options, e.g. `new OpenAI({ ...fetchOption(fetcher) })`.
 */
export function fetchOption(fetcher?: typeof fetch): { fetch?: typeof fetch } {
  return fetcher ? { fetch: fetcher } : {};
}
