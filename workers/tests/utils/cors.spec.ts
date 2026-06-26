/**
 * CORS Utility Tests
 *
 * Tests for shared CORS module with wildcard pattern support.
 * Covers pattern parsing, origin matching, header generation,
 * preflight handling, and WebSocket response passthrough.
 */

import { describe, it, expect } from 'vitest';
import {
  parseOriginPatterns,
  isOriginAllowed,
  getCorsHeaders,
  addCorsHeaders,
  handlePreflight,
  buildCorsPatterns,
} from '../../src/utils/cors';

// =============================================================================
// parseOriginPatterns
// =============================================================================

describe('parseOriginPatterns', () => {
  it('should parse exact origins', () => {
    const patterns = parseOriginPatterns('https://example.com,http://localhost:3000');
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toEqual({ type: 'exact', value: 'https://example.com' });
    expect(patterns[1]).toEqual({ type: 'exact', value: 'http://localhost:3000' });
  });

  it('should parse wildcard match-all (*)', () => {
    const patterns = parseOriginPatterns('*');
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toEqual({ type: 'wildcard-all' });
  });

  it('should parse subdomain wildcard patterns', () => {
    const patterns = parseOriginPatterns('https://*.pantheonsite.io');
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toEqual({
      type: 'wildcard-subdomain',
      regex: expect.any(RegExp),
    });
  });

  it('should trim whitespace from patterns', () => {
    const patterns = parseOriginPatterns('  https://a.com , https://b.com  ');
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toEqual({ type: 'exact', value: 'https://a.com' });
    expect(patterns[1]).toEqual({ type: 'exact', value: 'https://b.com' });
  });

  it('should filter empty strings', () => {
    const patterns = parseOriginPatterns('https://a.com,,https://b.com,');
    expect(patterns).toHaveLength(2);
  });

  it('should reject patterns without protocol', () => {
    const patterns = parseOriginPatterns('example.com');
    expect(patterns).toHaveLength(0);
  });

  it('should reject patterns with multiple wildcards', () => {
    const patterns = parseOriginPatterns('https://*.*.example.com');
    expect(patterns).toHaveLength(0);
  });

  it('should enforce max 50 patterns', () => {
    const origins = Array.from({ length: 60 }, (_, i) => `https://host${String(i)}.com`).join(',');
    const patterns = parseOriginPatterns(origins);
    expect(patterns).toHaveLength(50);
  });

  it('should return empty array for empty string', () => {
    const patterns = parseOriginPatterns('');
    expect(patterns).toHaveLength(0);
  });

  it('should handle mixed valid and invalid patterns', () => {
    const patterns = parseOriginPatterns('https://valid.com,no-protocol.com,https://*.wild.io');
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toEqual({ type: 'exact', value: 'https://valid.com' });
    expect(patterns[1]).toEqual({ type: 'wildcard-subdomain', regex: expect.any(RegExp) });
  });
});

// =============================================================================
// isOriginAllowed
// =============================================================================

describe('isOriginAllowed', () => {
  it('should allow exact match', () => {
    const patterns = parseOriginPatterns('https://example.com');
    expect(isOriginAllowed('https://example.com', patterns)).toBe(true);
  });

  it('should reject non-matching origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    expect(isOriginAllowed('https://other.com', patterns)).toBe(false);
  });

  it('should allow any origin with wildcard-all (*)', () => {
    const patterns = parseOriginPatterns('*');
    expect(isOriginAllowed('https://anything.com', patterns)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', patterns)).toBe(true);
  });

  it('should match subdomain wildcard', () => {
    const patterns = parseOriginPatterns('https://*.pantheonsite.io');
    expect(isOriginAllowed('https://mysite.pantheonsite.io', patterns)).toBe(true);
    expect(isOriginAllowed('https://another-site.pantheonsite.io', patterns)).toBe(true);
  });

  it('should NOT match multi-level subdomain against single wildcard', () => {
    const patterns = parseOriginPatterns('https://*.example.com');
    expect(isOriginAllowed('https://a.b.example.com', patterns)).toBe(false);
  });

  it('should reject protocol mismatch on wildcard', () => {
    const patterns = parseOriginPatterns('https://*.example.com');
    expect(isOriginAllowed('http://app.example.com', patterns)).toBe(false);
  });

  it('should return false for null origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    expect(isOriginAllowed(null, patterns)).toBe(false);
  });

  it('should return false for empty string origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    expect(isOriginAllowed('', patterns)).toBe(false);
  });

  it('should return false for empty patterns array', () => {
    expect(isOriginAllowed('https://example.com', [])).toBe(false);
  });

  it('should match against multiple patterns', () => {
    const patterns = parseOriginPatterns('https://a.com,https://*.b.com,http://localhost:3000');
    expect(isOriginAllowed('https://a.com', patterns)).toBe(true);
    expect(isOriginAllowed('https://app.b.com', patterns)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', patterns)).toBe(true);
    expect(isOriginAllowed('https://evil.com', patterns)).toBe(false);
  });

  it('should handle wildcard with port', () => {
    const patterns = parseOriginPatterns('https://*.example.com:8080');
    expect(isOriginAllowed('https://app.example.com:8080', patterns)).toBe(true);
    expect(isOriginAllowed('https://app.example.com', patterns)).toBe(false);
  });

  it('should handle hyphens in subdomain', () => {
    const patterns = parseOriginPatterns('https://*.example.com');
    expect(isOriginAllowed('https://my-app.example.com', patterns)).toBe(true);
  });

  it('should not allow wildcards to match empty subdomain', () => {
    const patterns = parseOriginPatterns('https://*.example.com');
    expect(isOriginAllowed('https://.example.com', patterns)).toBe(false);
    expect(isOriginAllowed('https://example.com', patterns)).toBe(false);
  });
});

// =============================================================================
// getCorsHeaders
// =============================================================================

describe('getCorsHeaders', () => {
  it('should return headers with allowed origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const headers = getCorsHeaders('https://example.com', patterns);

    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('should return empty origin for disallowed origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const headers = getCorsHeaders('https://evil.com', patterns);

    expect(headers['Access-Control-Allow-Origin']).toBe('');
  });

  it('should use custom allowed headers when provided', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const customHeaders = 'Content-Type, X-Custom-Header';
    const headers = getCorsHeaders('https://example.com', patterns, customHeaders);

    expect(headers['Access-Control-Allow-Headers']).toBe(customHeaders);
  });

  it('should return empty origin for null origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const headers = getCorsHeaders(null, patterns);

    expect(headers['Access-Control-Allow-Origin']).toBe('');
  });

  it('should emit literal * and omit Allow-Credentials when pattern set is wildcard-all', () => {
    const patterns = parseOriginPatterns('*');
    const headers = getCorsHeaders('https://any-origin.com', patterns);

    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('should reflect specific origin with Allow-Credentials when pattern set is explicit', () => {
    const patterns = parseOriginPatterns('https://allowed.com');
    const headers = getCorsHeaders('https://allowed.com', patterns);

    expect(headers['Access-Control-Allow-Origin']).toBe('https://allowed.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });
});

// =============================================================================
// addCorsHeaders
// =============================================================================

describe('addCorsHeaders', () => {
  it('should add CORS headers to a regular response', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = new Response('OK', { status: 200 });
    const result = addCorsHeaders(response, 'https://example.com', patterns);

    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(result.status).toBe(200);
  });

  it('should not add CORS headers for disallowed origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = new Response('OK', { status: 200 });
    const result = addCorsHeaders(response, 'https://evil.com', patterns);

    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('should skip WebSocket upgrade responses', () => {
    const patterns = parseOriginPatterns('https://example.com');
    // Simulate a WebSocket response by adding webSocket property
    // In CF Workers, WebSocket upgrade responses have status 101 and a webSocket property.
    // Standard Response doesn't allow 101, so we use 200 and attach the webSocket property.
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, 'webSocket', { value: {}, writable: false });

    const result = addCorsHeaders(response, 'https://example.com', patterns);

    // Should return the original response unmodified
    expect(result).toBe(response);
  });

  it('should not add CORS headers for null origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = new Response('OK', { status: 200 });
    const result = addCorsHeaders(response, null, patterns);

    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('should not add CORS headers for empty origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = new Response('OK', { status: 200 });
    const result = addCorsHeaders(response, '', patterns);

    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('should preserve original response body and status', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = new Response(JSON.stringify({ data: 'test' }), {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = addCorsHeaders(response, 'https://example.com', patterns);

    expect(result.status).toBe(201);
    expect(result.statusText).toBe('Created');
    expect(result.headers.get('Content-Type')).toBe('application/json');
  });
});

// =============================================================================
// handlePreflight
// =============================================================================

describe('handlePreflight', () => {
  it('should return 204 for allowed origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = handlePreflight('https://example.com', patterns);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('should return 403 for disallowed origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = handlePreflight('https://evil.com', patterns);

    expect(response.status).toBe(403);
  });

  it('should return 403 for null origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = handlePreflight(null, patterns);

    expect(response.status).toBe(403);
  });

  it('should return 403 for empty origin', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const response = handlePreflight('', patterns);

    expect(response.status).toBe(403);
  });

  it('should use custom allowed headers', () => {
    const patterns = parseOriginPatterns('https://example.com');
    const customHeaders = 'Content-Type, X-Special';
    const response = handlePreflight('https://example.com', patterns, customHeaders);

    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(customHeaders);
  });

  it('should allow wildcard subdomain in preflight', () => {
    const patterns = parseOriginPatterns('https://*.app.io');
    const response = handlePreflight('https://mysite.app.io', patterns);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://mysite.app.io');
  });
});

// =============================================================================
// localhost system default
// =============================================================================

describe('localhost system default (isOriginAllowed)', () => {
  it('should allow http://localhost on any port', () => {
    expect(isOriginAllowed('http://localhost:3000', [])).toBe(true);
    expect(isOriginAllowed('http://localhost:8080', [])).toBe(true);
    expect(isOriginAllowed('http://localhost:8787', [])).toBe(true);
    expect(isOriginAllowed('http://localhost', [])).toBe(true);
  });

  it('should allow https://localhost on any port', () => {
    expect(isOriginAllowed('https://localhost:3000', [])).toBe(true);
    expect(isOriginAllowed('https://localhost', [])).toBe(true);
  });

  it('should allow 127.0.0.1 on any port', () => {
    expect(isOriginAllowed('http://127.0.0.1:5173', [])).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3000', [])).toBe(true);
    expect(isOriginAllowed('https://127.0.0.1:3000', [])).toBe(true);
  });

  it('should not treat localhost-prefixed domains as localhost', () => {
    expect(isOriginAllowed('https://localhost.evil.com', [])).toBe(false);
    expect(isOriginAllowed('https://not-localhost.com', [])).toBe(false);
  });
});

// =============================================================================
// buildCorsPatterns
// =============================================================================

describe('buildCorsPatterns', () => {
  describe('default open (no allowed_origins configured)', () => {
    it('should return wildcard when site origins are null', () => {
      const patterns = buildCorsPatterns(undefined, null);
      expect(isOriginAllowed('https://anything.com', patterns)).toBe(true);
      expect(isOriginAllowed('https://evil.com', patterns)).toBe(true);
    });

    it('should return wildcard when site origins are empty array', () => {
      const patterns = buildCorsPatterns('https://dashboard.example.com', []);
      expect(isOriginAllowed('https://anything.com', patterns)).toBe(true);
    });

    it('should return wildcard when site origins are undefined', () => {
      const patterns = buildCorsPatterns(undefined, undefined);
      expect(isOriginAllowed('https://anything.com', patterns)).toBe(true);
      // localhost always works
      expect(isOriginAllowed('http://localhost:3000', patterns)).toBe(true);
    });
  });

  describe('opted-in restriction (allowed_origins configured)', () => {
    it('should allow configured per-site origin and block others', () => {
      const patterns = buildCorsPatterns(undefined, ['https://custom-domain.com']);
      expect(isOriginAllowed('https://custom-domain.com', patterns)).toBe(true);
      expect(isOriginAllowed('https://evil.com', patterns)).toBe(false);
    });

    it('should include global env origins alongside per-site origins', () => {
      const patterns = buildCorsPatterns('https://dashboard.example.com', ['https://site.com']);
      expect(isOriginAllowed('https://site.com', patterns)).toBe(true);
      expect(isOriginAllowed('https://dashboard.example.com', patterns)).toBe(true);
      expect(isOriginAllowed('https://evil.com', patterns)).toBe(false);
    });

    it('should NOT allow arbitrary domains not in the configured list', () => {
      const patterns = buildCorsPatterns(undefined, ['https://allowed.com']);
      expect(isOriginAllowed('https://rko2026.pantheon.io', patterns)).toBe(false);
      expect(isOriginAllowed('https://mysite.pantheonsite.io', patterns)).toBe(false);
    });

    it('should support wildcard patterns in per-site origins', () => {
      const patterns = buildCorsPatterns(undefined, ['https://*.custom-domain.com']);
      expect(isOriginAllowed('https://app.custom-domain.com', patterns)).toBe(true);
      expect(isOriginAllowed('https://other.custom-domain.com', patterns)).toBe(true);
      expect(isOriginAllowed('https://evil.com', patterns)).toBe(false);
    });

    it('localhost is always allowed even when opted-in to restriction', () => {
      const patterns = buildCorsPatterns(undefined, ['https://custom-domain.com']);
      expect(isOriginAllowed('http://localhost:3000', patterns)).toBe(true);
      expect(isOriginAllowed('https://localhost', patterns)).toBe(true);
    });
  });
});
