/**
 * CCR Client - Documents Template Binding Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client documents - template binding', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create with template binding', () => {
    it('should send templateId and templateVersion in request body', async () => {
      const mockDocument = {
        id: 'doc-1',
        siteId: 'site-1',
        path: '/blog-post',
        archived: false,
        createdAt: '2026-06-08T00:00:00Z',
        updatedAt: '2026-06-08T00:00:00Z',
        templateId: 'template-1',
        templateVersion: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ document: mockDocument }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.documents.create({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: '/blog-post',
        templateId: 'template-1',
        templateVersion: 5,
      });

      expect(result.templateId).toBe('template-1');
      expect(result.templateVersion).toBe(5);

      // Verify request body includes template fields
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.path).toBe('/blog-post');
      expect(body.templateId).toBe('template-1');
      expect(body.templateVersion).toBe(5);
    });

    it('should create document without template binding when fields not provided', async () => {
      const mockDocument = {
        id: 'doc-2',
        siteId: 'site-1',
        path: '/blank-page',
        archived: false,
        createdAt: '2026-06-08T00:00:00Z',
        updatedAt: '2026-06-08T00:00:00Z',
        templateId: null,
        templateVersion: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ document: mockDocument }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.documents.create({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: '/blank-page',
      });

      expect(result.templateId).toBeNull();
      expect(result.templateVersion).toBeNull();

      // Verify request body does NOT include template fields
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.path).toBe('/blank-page');
      expect(body.templateId).toBeUndefined();
      expect(body.templateVersion).toBeUndefined();
    });

    it('should send only templateId if templateVersion not provided', async () => {
      const mockDocument = {
        id: 'doc-3',
        siteId: 'site-1',
        path: '/blog-post-2',
        archived: false,
        createdAt: '2026-06-08T00:00:00Z',
        updatedAt: '2026-06-08T00:00:00Z',
        templateId: 'template-1',
        templateVersion: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ document: mockDocument }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const result = await client.documents.create({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: '/blog-post-2',
        templateId: 'template-1',
      });

      expect(result.templateId).toBe('template-1');
      expect(result.templateVersion).toBe(5);

      // Verify request body includes templateId but not templateVersion
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.templateId).toBe('template-1');
      expect(body.templateVersion).toBeUndefined();
    });
  });

  describe('list documents with template binding', () => {
    it('should return templateId and templateVersion for each document', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          siteId: 'site-1',
          path: '/blog-post-1',
          archived: false,
          createdAt: '2026-06-08T00:00:00Z',
          updatedAt: '2026-06-08T00:00:00Z',
          templateId: 'template-blog',
          templateVersion: 3,
        },
        {
          id: 'doc-2',
          siteId: 'site-1',
          path: '/blank-page',
          archived: false,
          createdAt: '2026-06-08T00:00:00Z',
          updatedAt: '2026-06-08T00:00:00Z',
          templateId: null,
          templateVersion: null,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ documents: mockDocuments }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const documents = await client.documents.list('site-1', 'branch-1');

      expect(documents).toHaveLength(2);
      expect(documents[0].templateId).toBe('template-blog');
      expect(documents[0].templateVersion).toBe(3);
      expect(documents[1].templateId).toBeNull();
      expect(documents[1].templateVersion).toBeNull();
    });
  });

  describe('get document with template binding', () => {
    it('should return templateId and templateVersion', async () => {
      const mockDocument = {
        id: 'doc-1',
        siteId: 'site-1',
        path: '/blog-post',
        archived: false,
        createdAt: '2026-06-08T00:00:00Z',
        updatedAt: '2026-06-08T00:00:00Z',
        templateId: 'template-blog',
        templateVersion: 7,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDocument,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const document = await client.documents.get('site-1', 'doc-1');

      expect(document.templateId).toBe('template-blog');
      expect(document.templateVersion).toBe(7);
    });
  });

  describe('getByPath with template binding', () => {
    it('should return templateId and templateVersion', async () => {
      const mockDocument = {
        id: 'doc-1',
        siteId: 'site-1',
        path: '/blog/my-post',
        archived: false,
        createdAt: '2026-06-08T00:00:00Z',
        updatedAt: '2026-06-08T00:00:00Z',
        templateId: 'template-blog',
        templateVersion: 4,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDocument,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const document = await client.documents.getByPath('site-1', '/blog/my-post');

      expect(document.templateId).toBe('template-blog');
      expect(document.templateVersion).toBe(4);
    });
  });
});
