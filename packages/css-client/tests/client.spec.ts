/**
 * CSS Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';
import {
  P1ApiError,
  NetworkError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with base URL', () => {
      const client = new P1Client({ baseUrl });
      expect(client).toBeInstanceOf(P1Client);
      expect(client.sites).toBeDefined();
      expect(client.branches).toBeDefined();
      expect(client.documents).toBeDefined();
      expect(client.versions).toBeDefined();
      expect(client.checkpoints).toBeDefined();
      expect(client.queries).toBeDefined();
    });

    it('should create client with API key', () => {
      const client = new P1Client({ baseUrl, apiKey });
      expect(client).toBeInstanceOf(P1Client);
    });
  });

  describe('sites endpoint', () => {
    it('should list sites', async () => {
      const mockSites = [
        { id: 'site-1', name: 'Site 1', pantheonSiteId: 'p1' },
        { id: 'site-2', name: 'Site 2', pantheonSiteId: 'p2' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sites: mockSites }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const sites = await client.sites.list();

      expect(sites).toEqual(mockSites);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': apiKey,
          }),
        })
      );
    });

    it('should get a site by ID', async () => {
      const mockSite = { id: 'site-1', name: 'Site 1', pantheonSiteId: 'p1' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSite,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const site = await client.sites.get('site-1');

      expect(site).toEqual(mockSite);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1`,
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('branches endpoint', () => {
    it('should list branches for a site', async () => {
      const mockBranches = [
        { id: 'branch-1', name: 'main', isMain: true },
        { id: 'branch-2', name: 'feature', isMain: false },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ branches: mockBranches }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const branches = await client.branches.list('site-1');

      expect(branches).toEqual(mockBranches);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create a branch', async () => {
      const mockBranch = { id: 'branch-new', name: 'feature', isMain: false };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockBranch,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const branch = await client.branches.create({
        siteId: 'site-1',
        name: 'feature',
        sourceBranchId: 'branch-1',
      });

      expect(branch).toEqual(mockBranch);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'feature', sourceBranchId: 'branch-1' }),
        })
      );
    });
  });

  describe('documents endpoint', () => {
    it('should list documents on a branch', async () => {
      const mockDocs = [
        { id: 'doc-1', path: '/home' },
        { id: 'doc-2', path: '/about' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ documents: mockDocs }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const docs = await client.documents.list('site-1', 'branch-1');

      expect(docs).toEqual(mockDocs);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches/branch-1/documents`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create a document', async () => {
      const mockDoc = { id: 'doc-new', path: '/new-page' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ document: mockDoc }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const doc = await client.documents.create({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: '/new-page',
      });

      expect(doc).toEqual(mockDoc);
    });
  });

  describe('versions endpoint', () => {
    it('should get latest version', async () => {
      const mockVersion = {
        id: 'ver-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        versionNumber: 3,
        snapshot: { content: [], root: {} },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockVersion,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const version = await client.versions.getLatest('site-1', 'branch-1', 'doc-1');

      expect(version).toEqual(mockVersion);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches/branch-1/documents/doc-1/versions/latest`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should create a version', async () => {
      const mockVersion = {
        id: 'ver-new',
        documentId: 'doc-1',
        branchId: 'branch-1',
        versionNumber: 4,
        snapshot: { content: [{ type: 'Text', props: { id: 't1' } }], root: {} },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockVersion,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const version = await client.versions.create('site-1', {
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: [{ type: 'Text', props: { id: 't1' } }], root: {} },
      });

      expect(version).toEqual(mockVersion);
    });
  });

  describe('checkpoints endpoint', () => {
    it('should create a checkpoint', async () => {
      const mockCheckpoint = {
        id: 'cp-1',
        branchId: 'branch-1',
        name: 'Release v1.0',
        checkpointType: 'manual',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockCheckpoint,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const checkpoint = await client.checkpoints.create('site-1', {
        branchId: 'branch-1',
        name: 'Release v1.0',
      });

      expect(checkpoint).toEqual(mockCheckpoint);
    });
  });

  describe('error handling', () => {
    it('should throw NotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Site not found' }),
      });

      const client = new P1Client({ baseUrl, apiKey });

      await expect(client.sites.get('nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should throw ValidationError for 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'path is required' }),
      });

      const client = new P1Client({ baseUrl, apiKey });

      await expect(
        client.documents.create({ siteId: 's1', branchId: 'b1', path: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ConflictError for 409', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Document already exists' }),
      });

      const client = new P1Client({ baseUrl, apiKey });

      await expect(
        client.documents.create({ siteId: 's1', branchId: 'b1', path: '/home' })
      ).rejects.toThrow(ConflictError);
    });

    it('should throw NetworkError on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new P1Client({ baseUrl, apiKey });

      await expect(client.sites.list()).rejects.toThrow(NetworkError);
    });

    it('should throw P1ApiError for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      const client = new P1Client({ baseUrl, apiKey });

      await expect(client.sites.list()).rejects.toThrow(P1ApiError);
    });
  });

  describe('principal handling', () => {
    it('should send principal headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sites: [] }),
      });

      const client = new P1Client({
        baseUrl,
        apiKey,
        principal: { id: 'user-123', type: 'user' },
      });

      await client.sites.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Principal-Id': 'user-123',
            'X-Principal-Type': 'user',
          }),
        })
      );
    });

    it('should create client with different principal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sites: [] }),
      });

      const client = new P1Client({ baseUrl, apiKey });
      const userClient = client.withPrincipal({ id: 'user-456', type: 'user' });

      await userClient.sites.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Principal-Id': 'user-456',
            'X-Principal-Type': 'user',
          }),
        })
      );
    });
  });
});
