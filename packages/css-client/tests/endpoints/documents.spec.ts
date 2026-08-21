/**
 * Documents Endpoint Tests
 *
 * The create body carries only identity and template linkage (path,
 * templateId, templateVersion, title); the backend builds the initial
 * version, so no snapshot key ever appears in the request.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentsEndpoint } from '../../src/endpoints/documents.js';
import type { BaseEndpoint } from '../../src/endpoints/base.js';

describe('DocumentsEndpoint', () => {
  let baseEndpoint: BaseEndpoint;
  let endpoint: DocumentsEndpoint;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
    baseEndpoint = { request: mockRequest } as unknown as BaseEndpoint;
    endpoint = new DocumentsEndpoint(baseEndpoint);
  });

  describe('create', () => {
    it('sends the template linkage and title in the create body', async () => {
      mockRequest.mockResolvedValue({ document: { id: 'doc-1', path: 'page-1' } });

      await endpoint.create({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: 'page-1',
        templateId: 'tmpl-1',
        templateVersion: 2,
        title: 'My page',
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [url, init] = mockRequest.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('/api/sites/site-1/branches/branch-1/documents');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        path: 'page-1',
        templateId: 'tmpl-1',
        templateVersion: 2,
        title: 'My page',
      });
    });

    it('omits absent optional fields from the create body', async () => {
      mockRequest.mockResolvedValue({ document: { id: 'doc-2', path: 'page-2' } });

      await endpoint.create({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: 'page-2',
      });

      const [, init] = mockRequest.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual({ path: 'page-2' });
    });
  });

  // The DAL wraps documents.list in withRetry, so a blank branch id here would
  // otherwise be retried with backoff before surfacing.
  describe('required path parameters', () => {
    it('rejects a blank branchId by name instead of building a malformed URL', async () => {
      await expect(endpoint.list('site-1', '')).rejects.toMatchObject({
        name: 'MissingParameterError',
        parameter: 'branchId',
        status: 400,
      });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('rejects a blank branchId on create, delete, exists and publish', async () => {
      await expect(
        endpoint.create({ siteId: 'site-1', branchId: '', path: 'p' }),
      ).rejects.toThrow('"branchId"');
      await expect(endpoint.delete('site-1', '', 'doc-1')).rejects.toThrow('"branchId"');
      await expect(endpoint.exists('site-1', '', 'doc-1')).rejects.toThrow('"branchId"');
      await expect(endpoint.publish('site-1', '', 'doc-1')).rejects.toThrow('"branchId"');
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

});
