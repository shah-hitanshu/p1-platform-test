/**
 * Smoke test: verify Anthropic prompt caching works through the Cloudflare AI Gateway
 * REST API (/ai/v1/messages). Makes two live calls with the REAL system prompt + tools
 * so it measures the actual cacheable prefix:
 *   Call 1 must report cache_creation_input_tokens > 0 (prefix is cacheable + above the
 *          model's minimum, and the request serializes deterministically).
 *   Call 2 (immediate, different trailing text) must report cache_read_input_tokens > 0
 *          (the prefix is byte-stable and the breakpoints are placed correctly).
 *
 * This is NOT a unit test — it costs money and needs a live Cloudflare API token, so it
 * runs on demand: `pnpm smoke:cache`. It also doubles as the verifier for the REST URL
 * join, the provider-prefixed model-id format, and Bearer auth (a bad one fails loudly here).
 *
 * Required env: AI_GATEWAY_API_TOKEN, AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_NAME.
 * Optional env: SMOKE_MODEL (default anthropic/claude-haiku-4-5 — cheapest for the probe).
 */
import { createTransport } from '../src/providers/transport.js';
import { CCR_TOOLS, WEB_TOOLS } from '../src/tools/definitions.js';
import { SYSTEM_PROMPT } from '../src/prompt/system-prompt.js';
import { reportGatewayFailure } from './smoke-failure.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    console.error(
      'Usage: AI_GATEWAY_API_TOKEN=... AI_GATEWAY_ACCOUNT_ID=... AI_GATEWAY_NAME=p1-chatbot pnpm smoke:cache',
    );
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  // Anthropic-only by design: `cache_creation_input_tokens` is what this measures, and the
  // OpenAI-compatible endpoint reports no such counter. A Workers AI id here proves nothing.
  const model = process.env.SMOKE_MODEL || 'anthropic/claude-haiku-4-5';
  if (!model.startsWith('anthropic/')) {
    console.error(`This probe measures Anthropic prompt caching; "${model}" cannot report it.`);
    process.exit(1);
  }
  const transport = createTransport({
    accountId: requireEnv('AI_GATEWAY_ACCOUNT_ID'),
    gatewayId: requireEnv('AI_GATEWAY_NAME'),
    apiToken: requireEnv('AI_GATEWAY_API_TOKEN'),
    model,
    tools: [...CCR_TOOLS, ...WEB_TOOLS],
  });

  console.log(`Model: ${model}\n`);

  const call1 = await transport.complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Reply with just "ok". (cache probe A)' }],
    maxTokens: 64,
  });
  console.log('Call 1 usage:', JSON.stringify(call1.usage));

  const call2 = await transport.complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Reply with just "ok". (cache probe B, different text)' }],
    maxTokens: 64,
  });
  console.log('Call 2 usage:', JSON.stringify(call2.usage));

  const created = call1.usage?.cacheCreationInputTokens ?? 0;
  const read = call2.usage?.cacheReadInputTokens ?? 0;

  const failures: string[] = [];
  if (created <= 0) {
    failures.push(
      'Call 1 cache_creation_input_tokens is 0 — prefix not cached. Likely causes: ' +
        'prefix below the model\'s cache minimum (Sonnet 2048 / Opus 4096 tokens), or ' +
        'non-deterministic request serialization.',
    );
  }
  if (read <= 0) {
    failures.push(
      'Call 2 cache_read_input_tokens is 0 — no cache hit. Likely causes: prefix byte-drift ' +
        'between calls, or cache_control breakpoints misplaced.',
    );
  }

  if (failures.length > 0) {
    console.error('\n❌ FAIL');
    for (const f of failures) console.error(' - ' + f);
    process.exit(1);
  }

  console.log(`\n✅ PASS — created ${created} tokens on call 1, read ${read} tokens on call 2.`);
}

main().catch((err: unknown) => {
  reportGatewayFailure(err, process.env.SMOKE_MODEL || 'anthropic/claude-haiku-4-5');
});
