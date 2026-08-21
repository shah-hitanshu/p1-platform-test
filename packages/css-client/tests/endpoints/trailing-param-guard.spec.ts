/**
 * A blank *trailing* path parameter is the one shape the BaseEndpoint backstop cannot
 * catch — the empty segment leaves a single trailing slash, the API strips it, and the
 * request succeeds against the collection route. `branches.get(siteId, '')` would hand
 * back the branch *list* typed as a `Branch`, with `.id` undefined and no error raised.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BranchesEndpoint } from '../../src/endpoints/branches.js';
import { SitesEndpoint } from '../../src/endpoints/sites.js';
import { QueriesEndpoint } from '../../src/endpoints/queries.js';
import { CheckpointsEndpoint } from '../../src/endpoints/checkpoints.js';
import { MergeEndpoint } from '../../src/endpoints/merge.js';
import { AgentRegistryEndpoint } from '../../src/endpoints/agent-registry.js';
import type { BaseEndpoint } from '../../src/endpoints/base.js';

describe('single-resource getters reject a blank trailing parameter', () => {
  let base: BaseEndpoint;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn().mockResolvedValue({});
    base = { request: mockRequest } as unknown as BaseEndpoint;
  });

  it('branches.get does not fall through to the branch list', async () => {
    await expect(new BranchesEndpoint(base).get('site-1', '')).rejects.toThrow(
      'Missing required parameter "branchId" for branches.get',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('sites.get does not fall through to the site list', async () => {
    await expect(new SitesEndpoint(base).get('')).rejects.toThrow('"siteId"');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('queries.get rejects a blank name', async () => {
    await expect(new QueriesEndpoint(base).get('site-1', 'branch-1', '')).rejects.toThrow(
      '"name"',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('checkpoints.get rejects a blank checkpointId', async () => {
    await expect(new CheckpointsEndpoint(base).get('site-1', '')).rejects.toThrow(
      '"checkpointId"',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('merge.getRequest rejects a blank requestId', async () => {
    await expect(new MergeEndpoint(base).getRequest('site-1', '')).rejects.toThrow(
      '"requestId"',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('agentRegistry.get rejects a blank agentId', async () => {
    await expect(new AgentRegistryEndpoint(base).get('org-1', '')).rejects.toThrow(
      '"agentId"',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('still passes a well-formed call through', async () => {
    await new BranchesEndpoint(base).get('site-1', 'branch-1');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/sites/site-1/branches/branch-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
