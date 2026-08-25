export interface Env {
  // Durable Object binding
  CHAT_AGENT: DurableObjectNamespace;

  // Environment vars
  ENVIRONMENT: string;
  CCR_BACKEND_URL: string;
  MEDIA_WORKER_URL: string;

  // Logger config — see telemetry.ts.
  LOG_LEVEL?: string;
  APP_VERSION?: string;
  /** Local ndjson collector, e.g. `http://127.0.0.1:8799`. Unset in every deployed env. */
  P1_LOG_SINK?: string;

  // AI Gateway REST API — model calls go through
  // api.cloudflare.com/client/v4/accounts/{AI_GATEWAY_ACCOUNT_ID}/ai/v1/{chat/completions|messages}.
  // AI_GATEWAY_ACCOUNT_ID is the Cloudflare account id (used in the URL path);
  // AI_GATEWAY_NAME is the gateway id, sent as the cf-aig-gateway-id header. Both required.
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;

  // Model to use, as "provider/model" (must contain a slash), e.g. @cf/moonshotai/...,
  // openai/gpt-4o, google-ai-studio/gemini-2.5-flash, anthropic/claude-... An `anthropic/`
  // prefix selects the /messages endpoint; everything else uses /chat/completions.
  // Optional — defaults in durable-objects/chat-agent.ts.
  AGENT_MODEL?: string;
  // Whether AGENT_MODEL can see images: "true" or "false". Set it alongside AGENT_MODEL —
  // see modelSeesImages for what an unset value assumes.
  AGENT_MODEL_VISION?: string;

  // Secrets (set via wrangler secret / .dev.vars)
  AGENT_ID: string;
  AGENT_API_KEY: string;
  // Cloudflare API token (AI Gateway Read/Edit + Workers AI Read) — authenticates the
  // Worker to the REST API via Bearer auth. Providers bill through the gateway's unified
  // billing, so no per-provider (Anthropic/OpenAI/…) key is needed.
  AI_GATEWAY_API_TOKEN: string;
}
