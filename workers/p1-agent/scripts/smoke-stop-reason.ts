/**
 * Smoke test: does the configured model report *why* it stopped?
 *
 * The turn loop drops a completion's tool calls when `stopReason === 'length'`, because a reply
 * cut at the output limit can carry a tool call truncated mid-JSON. That whole path is inert if
 * the provider reports no stop reason — `stopReason` stays undefined, the completion reads as
 * finished, and a half-written call is executed. The OpenAI-compatible gateway endpoint fronts
 * Workers AI, OpenAI and Google alike, and they do not all populate `finish_reason`.
 *
 * Call 1 forces truncation with a tiny max_tokens: it must report `length`.
 * Call 2 asks for one word: it must report `stop` (or `tool_calls`).
 *
 * Costs money and needs a live Cloudflare API token, so it runs on demand:
 *   AI_GATEWAY_API_TOKEN=... AI_GATEWAY_ACCOUNT_ID=... AI_GATEWAY_NAME=p1-chatbot pnpm smoke:stop-reason
 * Optional: SMOKE_MODEL (defaults to the model wrangler.jsonc deploys).
 */
import { createTransport } from '../src/providers/transport.js';
import { CCR_TOOLS, WEB_TOOLS } from '../src/tools/definitions.js';
import { reportGatewayFailure } from './smoke-failure.js';

const DEPLOYED_MODEL = '@cf/moonshotai/kimi-k2.7-code';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const model = process.env.SMOKE_MODEL || DEPLOYED_MODEL;
  const transport = createTransport({
    accountId: requireEnv('AI_GATEWAY_ACCOUNT_ID'),
    gatewayId: requireEnv('AI_GATEWAY_NAME'),
    apiToken: requireEnv('AI_GATEWAY_API_TOKEN'),
    model,
    tools: [...CCR_TOOLS, ...WEB_TOOLS],
  });
  console.log(`Model: ${model}\n`);

  const silent = { onText: () => {}, onToolCallStart: () => {} };

  const cut = await transport.stream(
    { system: 'You are helpful.', messages: [{ role: 'user', content: 'Write four paragraphs about the sea.' }], maxTokens: 16 },
    silent,
  );
  console.log(`truncated call  -> stopReason: ${String(cut.stopReason)}  (want: length)`);

  const short = await transport.stream(
    { system: 'You are helpful.', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 256 },
    silent,
  );
  console.log(`short call      -> stopReason: ${String(short.stopReason)}  (want: stop or tool_calls)`);

  if (cut.stopReason !== 'length') {
    console.error(
      `\nFAIL: ${model} did not report a truncated reply.\n` +
      'The turn loop cannot tell a cut reply from a finished one on this model, so a tool call\n' +
      'truncated mid-JSON will be executed. Do not rely on the truncation path here.',
    );
    process.exit(1);
  }
  console.log('\nOK: truncation is detectable on this model.');
}

main().catch((err: unknown) => {
  reportGatewayFailure(err, process.env.SMOKE_MODEL || DEPLOYED_MODEL);
});
