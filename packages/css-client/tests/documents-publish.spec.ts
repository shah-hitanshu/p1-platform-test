/**
 * CCR Client - Documents Publish Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';
import { P1ApiError } from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client documents.publish', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should publish a document and return checkpoint and publishedVersionId', async () => {
    const mockResult = {
      checkpoint: {
        id: 'cp-1',
        branchId: 'branch-1',
        name: 'Publish doc-1',
        checkpointType: 'publish',
      },
      publishedVersionId: 'ver-published-1',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResult,
    });

    const client = new P1Client({ baseUrl, apiKey });
    const result = await client.documents.publish('site-1', 'branch-1', 'doc-1');

    expect(result).toEqual(mockResult);
    expect(result.checkpoint).toBeDefined();
    expect(result.publishedVersionId).toBe('ver-published-1');
  });

  it('should call the correct URL and method', async () => {
    const mockResult = {
      checkpoint: {
        id: 'cp-2',
        branchId: 'branch-2',
        name: 'Publish doc-2',
        checkpointType: 'publish',
      },
      publishedVersionId: 'ver-published-2',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResult,
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.documents.publish('site-1', 'branch-2', 'doc-2');

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/api/sites/site-1/branches/branch-2/documents/doc-2/publish`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should throw P1ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    const client = new P1Client({ baseUrl, apiKey });

    await expect(
      client.documents.publish('site-1', 'branch-1', 'doc-1')
    ).rejects.toThrow(P1ApiError);
  });

  it('should pass auth headers correctly', async () => {
    const mockResult = {
      checkpoint: {
        id: 'cp-3',
        branchId: 'branch-1',
        name: 'Publish doc-1',
        checkpointType: 'publish',
      },
      publishedVersionId: 'ver-published-3',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResult,
    });

    const client = new P1Client({ baseUrl, apiKey });
    await client.documents.publish('site-1', 'branch-1', 'doc-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-Key': apiKey,
        }),
      })
    );
  });
});
