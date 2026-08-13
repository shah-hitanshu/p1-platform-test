import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  ATTR_DB_COLLECTION_NAME,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_RESPONSE_RETURNED_ROWS,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
} from '@opentelemetry/semantic-conventions/incubating';
import { describe, expect, it } from 'vitest';
import { ALLOWED_FIELDS } from '../src/redact.js';

/**
 * Field names are a one-way door: once a dashboard, saved query, or alert rule
 * references one, changing it means migrating systems we don't own.
 *
 * Production code writes these names as string literals, because importing them costs
 * ~59 KB gzipped in a Worker bundle — `@opentelemetry/semantic-conventions` ships no
 * `import` condition, so wrangler resolves its untree-shakeable CJS build. This file is
 * where the constants are worth their weight: test code is never bundled, so it can
 * import them and assert the literals still agree.
 *
 * That covers both failure modes. A typo fails here; so does an upstream rename adopted
 * silently on `pnpm up` — and nine of these nineteen are still `/incubating`, where
 * renames are explicitly permitted.
 *
 * A failure here is not a bug to paper over. It means deciding whether to follow the
 * rename (and migrate the dashboards) or hold the old name deliberately.
 */
const PINNED: Record<string, string> = {
  // Stable — renames here would be a spec violation, pinned for symmetry.
  [ATTR_SERVICE_NAME]: 'service.name',
  [ATTR_SERVICE_VERSION]: 'service.version',
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: 'deployment.environment.name',
  [ATTR_HTTP_ROUTE]: 'http.route',
  [ATTR_HTTP_REQUEST_METHOD]: 'http.request.method',
  [ATTR_HTTP_RESPONSE_STATUS_CODE]: 'http.response.status_code',
  [ATTR_SERVER_ADDRESS]: 'server.address',
  [ATTR_ERROR_TYPE]: 'error.type',
  [ATTR_DB_OPERATION_NAME]: 'db.operation.name',
  [ATTR_DB_COLLECTION_NAME]: 'db.collection.name',

  // Incubating — upstream may rename these, which is the reason this file exists.
  [ATTR_DB_RESPONSE_RETURNED_ROWS]: 'db.response.returned_rows',
  [ATTR_GEN_AI_SYSTEM]: 'gen_ai.system',
  [ATTR_GEN_AI_REQUEST_MODEL]: 'gen_ai.request.model',
  [ATTR_GEN_AI_RESPONSE_MODEL]: 'gen_ai.response.model',
  [ATTR_GEN_AI_RESPONSE_FINISH_REASONS]: 'gen_ai.response.finish_reasons',
  [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: 'gen_ai.usage.input_tokens',
  [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: 'gen_ai.usage.output_tokens',
  [ATTR_GEN_AI_TOOL_NAME]: 'gen_ai.tool.name',
  [ATTR_GEN_AI_OPERATION_NAME]: 'gen_ai.operation.name',
};

describe('semantic convention names', () => {
  it.each(Object.entries(PINNED))('resolves to %s', (name, expected) => {
    expect(name).toBe(expected);
  });

  it('keeps every pinned attribute in the allow-list, or it would be redacted', () => {
    const allowed = new Set(ALLOWED_FIELDS);
    // Resource attributes live on the line itself, not in `ctx`, so they are exempt.
    const onTheLine = new Set([
      'service.name',
      'service.version',
      'deployment.environment.name',
    ]);
    for (const name of Object.keys(PINNED)) {
      if (onTheLine.has(name)) continue;
      expect(allowed, `${name} is emitted but not allow-listed`).toContain(name);
    }
  });
});
