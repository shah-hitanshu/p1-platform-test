/**
 * Health Endpoint Tests
 */

import { describe, it, expect } from 'vitest';

describe('Health endpoint', () => {
  // Test 32: Returns 200 with status healthy
  it('should return 200 with status healthy', async () => {
    const { handleHealthCheck } = await import('../src/health.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('ccr-mcp-server');
  });

  // Test 33: Includes environment and timestamp
  it('should include environment and valid timestamp', async () => {
    const { handleHealthCheck } = await import('../src/health.js');
    const response = handleHealthCheck('sbx1');
    const body = await response.json();
    expect(body.environment).toBe('sbx1');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
