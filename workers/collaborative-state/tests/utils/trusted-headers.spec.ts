import { describe, it, expect } from 'vitest';
import { stripInboundTrustedHeaders } from '../../src/utils/trusted-headers';

describe('stripInboundTrustedHeaders', () => {
  it('removes caller-supplied X-Verified-* headers', () => {
    const request = new Request('https://example.com/api/x', {
      headers: {
        'X-Verified-Actor-Id': 'victim-agent',
        'X-Verified-Actor-Type': 'agent',
        'X-Verified-Email': 'victim@example.com',
        'Content-Type': 'application/json',
      },
    });

    const scrubbed = stripInboundTrustedHeaders(request);

    expect(scrubbed.headers.get('X-Verified-Actor-Id')).toBeNull();
    expect(scrubbed.headers.get('X-Verified-Actor-Type')).toBeNull();
    expect(scrubbed.headers.get('X-Verified-Email')).toBeNull();
    // Unrelated headers are preserved.
    expect(scrubbed.headers.get('Content-Type')).toBe('application/json');
  });

  it('strips case-insensitively', () => {
    const request = new Request('https://example.com/api/x', {
      headers: { 'x-verified-actor-id': 'victim-agent' },
    });

    const scrubbed = stripInboundTrustedHeaders(request);

    expect(scrubbed.headers.get('X-Verified-Actor-Id')).toBeNull();
  });

  it('returns the same request instance when no trusted headers are present', () => {
    const request = new Request('https://example.com/api/x', {
      headers: { 'X-Agent-Trigger': 'autonomous', 'Content-Type': 'application/json' },
    });

    const result = stripInboundTrustedHeaders(request);

    expect(result).toBe(request);
  });
});
