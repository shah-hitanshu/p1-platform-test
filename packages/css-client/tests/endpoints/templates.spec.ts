/**
 * Templates Endpoint Tests
 *
 * Tests for the TemplatesEndpoint class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplatesEndpoint } from '../../src/endpoints/templates.js';
import type { BaseEndpoint } from '../../src/endpoints/base.js';
import { MissingParameterError, P1ApiError } from '../../src/errors.js';
import type {
  Template,
  TemplateSummary,
  CreateTemplateParams,
  UpdateTemplateParams,
  MigrationPreview,
} from '../../src/types.js';

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tmpl-1',
    name: 'blog',
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    content: [
      { type: 'HeroBlock', props: { id: 'HeroBlock-a1b2', title: '' } },
    ],
    root: {
      props: {
        _template: { label: 'Blog', deprecated: false },
        _pinMap: { 'HeroBlock-a1b2': true },
      },
    },
    zones: {},
    ...overrides,
  };
}

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
    it('makes GET request and returns metadata summaries', async () => {
      const mockTemplates: TemplateSummary[] = [
        {
          id: 'tmpl-1',
          name: 'blog',
          label: 'Blog',
          description: 'Blog post layout',
          defaultUrlPattern: '/blog/:slug',
          deprecated: false,
          version: 1,
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
    it('makes GET request and returns the stored snapshot with identifiers', async () => {
      const mockTemplate = makeTemplate();

      mockRequest.mockResolvedValue(mockTemplate);

      const result = await endpoint.get('site-123', 'branch-456', 'tmpl-1');

      expect(mockRequest).toHaveBeenCalledWith('/api/sites/site-123/branches/branch-456/templates/tmpl-1', {
        method: 'GET',
      });
      expect(result).toEqual(mockTemplate);
      expect(result.content[0].props.id).toBe('HeroBlock-a1b2');
      expect(result.root.props._template.label).toBe('Blog');
    });
  });

  describe('create', () => {
    it('makes POST request with metadata-only params', async () => {
      const params: CreateTemplateParams = {
        name: 'blog',
        label: 'Blog Post',
        description: 'Blog post layout',
        defaultUrlPattern: '/blog/:slug',
      };

      const mockResponse = makeTemplate({
        id: 'tmpl-new',
        content: [],
        root: {
          props: {
            _template: {
              label: 'Blog Post',
              description: 'Blog post layout',
              defaultUrlPattern: '/blog/:slug',
              deprecated: false,
            },
            _pinMap: {},
          },
        },
      });

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
    it('makes PATCH request with metadata-only params', async () => {
      const params: UpdateTemplateParams = {
        label: 'Updated Label',
        description: 'Updated description',
      };

      const mockResponse = makeTemplate({
        version: 2,
        updatedAt: '2026-01-02T00:00:00Z',
        root: {
          props: {
            _template: {
              label: 'Updated Label',
              description: 'Updated description',
              deprecated: false,
            },
            _pinMap: { 'HeroBlock-a1b2': true },
          },
        },
      });

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
      const mockResponse = makeTemplate();

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
      const mockResponse = makeTemplate();

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

  describe('previewMigration', () => {
    it('makes POST request without a detail query when detail is omitted', async () => {
      const preview: MigrationPreview = {
        templateId: 'tmpl-1',
        fromVersion: 1,
        toVersion: 2,
        templateDelta: [],
        affectedDocuments: 2,
        estimatedConflicts: 0,
        cleanDocuments: 2,
      };

      mockRequest.mockResolvedValue(preview);

      const result = await endpoint.previewMigration('site-123', 'branch-456', 'tmpl-1', {
        fromVersion: 1,
        toVersion: 2,
      });

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/templates/tmpl-1/migrate/preview',
        {
          method: 'POST',
          body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
        },
      );
      expect(result).toEqual(preview);
    });

    it('appends detail=true and returns the per-document breakdown', async () => {
      const preview: MigrationPreview = {
        templateId: 'tmpl-1',
        fromVersion: 1,
        toVersion: 2,
        templateDelta: [],
        affectedDocuments: 1,
        estimatedConflicts: 0,
        cleanDocuments: 1,
        documents: [
          {
            documentId: 'doc-1',
            path: '/blog/hello',
            currentTemplateVersion: 1,
            hasConflict: false,
            proposedSnapshot: { content: [] },
          },
        ],
      };

      mockRequest.mockResolvedValue(preview);

      const result = await endpoint.previewMigration(
        'site-123',
        'branch-456',
        'tmpl-1',
        { fromVersion: 1, toVersion: 2 },
        true,
      );

      expect(mockRequest).toHaveBeenCalledWith(
        '/api/sites/site-123/branches/branch-456/templates/tmpl-1/migrate/preview?detail=true',
        {
          method: 'POST',
          body: JSON.stringify({ fromVersion: 1, toVersion: 2 }),
        },
      );
      expect(result.documents?.[0].path).toBe('/blog/hello');
    });
  });

  describe('required path parameters', () => {
    it('rejects an empty branchId instead of building a malformed URL', async () => {
      await expect(endpoint.list('site-1', '')).rejects.toThrow(MissingParameterError);
      await expect(endpoint.list('site-1', '')).rejects.toThrow(
        'Missing required parameter "branchId" for templates.list',
      );
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('rejects an undefined branchId', async () => {
      await expect(
        endpoint.list('site-1', undefined as unknown as string),
      ).rejects.toThrow('Missing required parameter "branchId" for templates.list');
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('names the missing parameter on the error', async () => {
      await expect(endpoint.get('site-1', '', 'tmpl-1')).rejects.toMatchObject({
        name: 'MissingParameterError',
        parameter: 'branchId',
      });
    });

    // Retry wrappers bail on a 400 and retry anything else; a missing argument can
    // never resolve itself between attempts.
    it('carries a 400 status and its own code so callers do not retry it', async () => {
      await expect(endpoint.list('site-1', '')).rejects.toMatchObject({
        status: 400,
        code: 'MISSING_PARAMETER',
      });
      await expect(endpoint.list('site-1', '')).rejects.toBeInstanceOf(P1ApiError);
    });

    it('rejects a blank siteId and templateId too', async () => {
      await expect(endpoint.list('', 'branch-1')).rejects.toThrow('"siteId"');
      await expect(endpoint.get('site-1', 'branch-1', '  ')).rejects.toThrow('"templateId"');
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

});
