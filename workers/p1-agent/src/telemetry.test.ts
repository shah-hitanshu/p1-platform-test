/**
 * The mention path's log fields have to survive redaction, which is a property of the
 * field *names* and is invisible to any test that mocks the logger.
 */

import { describe, expect, it } from 'vitest';
import { ensureLogger } from './telemetry';

describe('field allow-list', () => {
  it('keeps every field the mention path emits', () => {
    const logger = ensureLogger({ ENVIRONMENT: 'local', LOG_LEVEL: 'debug' });
    const lines: Record<string, unknown>[] = [];
    logger.addSink({
      id: 'capture',
      write: (line) => lines.push(line as unknown as Record<string, unknown>),
      flush: async () => undefined,
    });

    logger.info('probe', {
      site_id: 's',
      thread_id: 't',
      comment_id: 'c',
      duration_ms: 12,
      count: 3,
    });

    expect((lines[0]?.context as Record<string, unknown>)._dropped).toBeUndefined();
  });
});
