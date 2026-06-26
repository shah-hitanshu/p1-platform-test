/**
 * Templates Endpoint Tests
 *
 * Tests for the TemplatesEndpoint class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplatesEndpoint } from '../../src/endpoints/templates.js';
import type { BaseEndpoint } from '../../src/endpoints/base.js';
import type { Template, CreateTemplateParams, UpdateTemplateParams } from '../../src/types.js';

describe('TemplatesEndpoint', () => {
  let baseEndpoint: BaseEndpoint;
  let endpoint: TemplatesEndpoint;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
    baseEndpoint = { request: mockRequest } as unknown as BaseEndpoint;
    endpoint = new TemplatesEndpoint(baseEndpoint);
  });

  describe('list', () => {
    it('makes GET request to list templates', async () => {
      const mockTemplates: Template[] = [
        {
          id: 'tmpl-1',
          name: 'blog',
          label: 'Blog',
          version: 1,
          components: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ];

      mockRequest.mockResolvedValue({ templates: mockTemplates });

      const result = await endpoint.list('site-123', 'branch-456');

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/templates',
        { method: 'GET' }
      );
      expect(result).toEqual(mockTemplates);
    });
  });

  describe('get', () => {
    it('makes GET request to fetch a template by ID', async () => {
      const mockTemplate: Template = {
        id: 'tmpl-1',
        name: 'blog',
        label: 'Blog',
        version: 1,
        components: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValue(mockTemplate);

      const result = await endpoint.get('site-123', 'branch-456', 'tmpl-1');

      expect(mockRequest).toHaveBeenCalledWith('/api/sites/site-123/branches/branch-456/templates/tmpl-1', {
        method: 'GET',
      });
      expect(result).toEqual(mockTemplate);
    });
  });

  describe('create', () => {
    it('makes POST request to create a template', async () => {
      const params: CreateTemplateParams = {
        name: 'blog',
        label: 'Blog Post',
        components: [],
      };

      const mockResponse: Template = {
        id: 'tmpl-new',
        ...params,
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValue(mockResponse);

      const result = await endpoint.create('site-123', 'branch-456', params);

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/templates',
        {
          method: 'POST',
          body: JSON.stringify(params),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('update', () => {
    it('makes PATCH request to update a template', async () => {
      const params: UpdateTemplateParams = {
        label: 'Updated Label',
        description: 'Updated description',
      };

      const mockResponse: Template = {
        id: 'tmpl-1',
        name: 'blog',
        label: 'Updated Label',
        description: 'Updated description',
        version: 2,
        components: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      };

      mockRequest.mockResolvedValue(mockResponse);

      const result = await endpoint.update('site-123', 'branch-456', 'tmpl-1', params);

      expect(mockRequest).toHaveBeenCalledWith('/api/sites/site-123/branches/branch-456/templates/tmpl-1', {
        method: 'PATCH',
        body: JSON.stringify(params),
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deprecate', () => {
    it('sends PATCH with deprecated: true', async () => {
      const mockResponse: Template = {
        id: 'tmpl-1',
        name: 'blog',
        label: 'Blog',
        version: 1,
        components: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValue(mockResponse);

      const result = await endpoint.deprecate('site-123', 'branch-456', 'tmpl-1');

      expect(mockRequest).toHaveBeenCalledWith('/api/sites/site-123/branches/branch-456/templates/tmpl-1', {
        method: 'PATCH',
        body: JSON.stringify({ deprecated: true }),
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('reactivate', () => {
    it('sends PATCH with deprecated: false', async () => {
      const mockResponse: Template = {
        id: 'tmpl-1',
        name: 'blog',
        label: 'Blog',
        version: 1,
        components: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValue(mockResponse);

      const result = await endpoint.reactivate('site-123', 'branch-456', 'tmpl-1');

      expect(mockRequest).toHaveBeenCalledWith('/api/sites/site-123/branches/branch-456/templates/tmpl-1', {
        method: 'PATCH',
        body: JSON.stringify({ deprecated: false }),
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('delete', () => {
    it('makes DELETE request to remove a template', async () => {
      mockRequest.mockResolvedValue(undefined);

      await endpoint.delete('site-123', 'branch-456', 'tmpl-1');

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/templates/tmpl-1',
        { method: 'DELETE' }
      );
    });
  });
});
