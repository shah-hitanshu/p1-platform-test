/**
 * Phase 7.1.1b: Node API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for structure node operations.
 * Nodes are associated with structures, which are branch-scoped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { makePrincipal } from '../helpers/principal';
import { makeBranch } from '../helpers/branch';

// Mock the services
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    createNode: vi.fn(),
    getNode: vi.fn(),
    listNodes: vi.fn(),
    updateNode: vi.fn(),
    deleteNode: vi.fn(),
    moveNode: vi.fn(),
    reorderNodes: vi.fn(),
    buildNavigationTree: vi.fn(),
    getBranch: vi.fn().mockResolvedValue({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true }),
    getBranchStructure: vi.fn(),
  };
});

// Mock authorization
vi.mock('../../src/auth/authorization', async () => {
  const actual = await vi.importActual('../../src/auth/authorization');
  return {
    ...actual,
    assertPermission: vi.fn(),
  };
});

describe('Phase 7.1.1b: Node API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes
  // ===========================================================================

  describe('POST - Create Node', () => {
    it('should create a new node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.createNode).mockResolvedValueOnce({
        id: 'node-uuid',
        structureId: 'struct-1',
        parentNodeId: null,
        name: 'Getting Started',
        slug: 'getting-started',
        nodeType: 'section',
        position: 0,
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Getting Started',
            slug: 'getting-started',
            nodeType: 'section',
            position: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.id).toBe('node-uuid');
      expect(body.name).toBe('Getting Started');
      expect(body.slug).toBe('getting-started');
    });

    it('should create a document node with documentId', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.createNode).mockResolvedValueOnce({
        id: 'node-uuid',
        structureId: 'struct-1',
        parentNodeId: null,
        name: 'Home Page',
        slug: 'home',
        nodeType: 'document',
        documentId: 'doc-uuid',
        position: 0,
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Home Page',
            slug: 'home',
            nodeType: 'document',
            documentId: 'doc-uuid',
            position: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(201);
      const body = await readJson(response);
      expect(body.nodeType).toBe('document');
      expect(body.documentId).toBe('doc-uuid');
    });

    it('should return 400 for missing name', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'test',
            nodeType: 'section',
            position: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('name');
    });

    it('should return 409 for duplicate slug', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.createNode).mockRejectedValueOnce(
        new services.DuplicateNodeSlugError('struct-1', 'existing-slug'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test Node',
            slug: 'existing-slug',
            nodeType: 'section',
            position: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(409);
    });

    it('should return 400 for invalid slug on create node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.createNode).mockRejectedValueOnce(
        new services.InvalidSlugError('slug "my node!" contains invalid characters; only letters, numbers, hyphens, underscores, and dots are allowed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'My Node',
            slug: 'my node!',
            nodeType: 'section',
            position: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('invalid characters');
    });
  });

  // ===========================================================================
  // GET - List Nodes
  // ===========================================================================

  describe('GET - List Nodes', () => {
    it('should list nodes in structure', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.listNodes).mockResolvedValueOnce([
        {
          id: 'node-1',
          structureId: 'struct-1',
          parentNodeId: null,
          name: 'Section A',
          slug: 'section-a',
          nodeType: 'section',
          position: 0,
          createdAt: '2026-01-24T10:00:00.000Z',
        },
        {
          id: 'node-2',
          structureId: 'struct-1',
          parentNodeId: null,
          name: 'Section B',
          slug: 'section-b',
          nodeType: 'section',
          position: 1,
          createdAt: '2026-01-24T11:00:00.000Z',
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.nodes).toHaveLength(2);
    });

    it('should filter by parent node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.listNodes).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes?parentId=node-1',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      expect(services.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({ parentNodeId: 'node-1' }),
      );
    });
  });

  // ===========================================================================
  // GET - Get Node
  // ===========================================================================

  describe('GET - Get Node', () => {
    it('should return node details', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getNode).mockResolvedValueOnce({
        id: 'node-1',
        structureId: 'struct-1',
        parentNodeId: null,
        name: 'Section A',
        slug: 'section-a',
        nodeType: 'section',
        position: 0,
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'node-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.id).toBe('node-1');
      expect(body.name).toBe('Section A');
    });

    it('should return 404 for non-existent node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getNode).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/nonexistent',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // PATCH - Update Node
  // ===========================================================================

  describe('PATCH - Update Node', () => {
    it('should update node properties', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateNode).mockResolvedValueOnce({
        id: 'node-1',
        structureId: 'struct-1',
        parentNodeId: null,
        name: 'Quick Start Guide',
        slug: 'quick-start',
        nodeType: 'section',
        position: 0,
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Quick Start Guide',
            slug: 'quick-start',
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'node-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.name).toBe('Quick Start Guide');
      expect(body.slug).toBe('quick-start');
    });

    it('should return 404 for non-existent node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateNode).mockRejectedValueOnce(
        new services.NodeNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/nonexistent',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated' }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid slug on update node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.updateNode).mockRejectedValueOnce(
        new services.InvalidSlugError('slug "a/b" contains invalid characters; only letters, numbers, hyphens, underscores, and dots are allowed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'a/b',
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'node-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.error).toContain('invalid characters');
    });
  });

  // ===========================================================================
  // DELETE - Delete Node
  // ===========================================================================

  describe('DELETE - Delete Node', () => {
    it('should delete a node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.deleteNode).mockResolvedValueOnce(undefined);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1',
        { method: 'DELETE' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'node-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.deleteNode).mockRejectedValueOnce(
        new services.NodeNotFoundError('nonexistent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/nonexistent',
        { method: 'DELETE' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // POST - Move Node
  // ===========================================================================

  describe('POST - Move Node', () => {
    it('should move node to new parent and position', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.moveNode).mockResolvedValueOnce({
        id: 'node-1',
        structureId: 'struct-1',
        parentNodeId: 'new-parent',
        name: 'Moved Node',
        slug: 'moved-node',
        nodeType: 'section',
        position: 2,
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1/move',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newParentId: 'new-parent',
            newPosition: 2,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'node-1',
        action: 'move',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.parentNodeId).toBe('new-parent');
      expect(body.position).toBe(2);
    });

    it('should return 400 for circular reference', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.moveNode).mockRejectedValueOnce(
        new services.CircularReferenceError(),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/node-1/move',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newParentId: 'node-1', // Moving to itself
            newPosition: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        nodeId: 'node-1',
        action: 'move',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST - Reorder Nodes
  // ===========================================================================

  describe('POST - Reorder Nodes', () => {
    it('should reorder sibling nodes', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.reorderNodes).mockResolvedValueOnce(undefined);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes/reorder',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentNodeId: null,
            nodeOrder: ['node-3', 'node-1', 'node-2'],
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'reorder',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.success).toBe(true);
      expect(body.reorderedCount).toBe(3);
    });
  });

  // ===========================================================================
  // GET - Navigation Tree
  // ===========================================================================

  describe('GET - Navigation Tree', () => {
    it('should return navigation tree', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Navigation',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.buildNavigationTree).mockResolvedValueOnce([
        {
          id: 'node-1',
          name: 'Getting Started',
          slug: 'getting-started',
          path: '/getting-started',
          nodeType: 'section',
          children: [
            {
              id: 'node-2',
              name: 'Installation',
              slug: 'installation',
              path: '/getting-started/installation',
              nodeType: 'document',
              documentId: 'doc-1',
              documentPath: 'docs/installation',
              children: [],
            },
          ],
        },
      ]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/navigation',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        action: 'navigation',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.structureId).toBe('struct-1');
      expect(body.structureName).toBe('Main Navigation');
      expect(body.tree).toHaveLength(1);
      expect(body.tree[0].children).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 404 for non-existent structure', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/nonexistent/nodes',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'nonexistent',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 405 for unsupported methods', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        { method: 'PUT' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(405);
    });

    it('should handle service errors gracefully', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchStructure).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(500);
    });
  });

  // ===========================================================================
  // Authorization
  // ===========================================================================

  describe('Authorization', () => {
    const authPrincipal = {
      id: 'user-1',
      type: 'user' as const,
      email: 'alice@example.com',
      pantheonSiteRoles: { 'site-1': 'admin' as const },
      tokenExpiry: '2026-01-24T10:00:00.000Z',
    };

    it('should check canView permission for GET list nodes', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.listNodes).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        { method: 'GET' },
      );

      await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canView',
      );
    });

    it('should check canEdit permission for POST create node', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');
      const { assertPermission } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        siteId: 'site-1',
        name: 'Main Nav',
        slug: 'main-nav',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      vi.mocked(services.createNode).mockResolvedValueOnce({
        id: 'node-uuid',
        structureId: 'struct-1',
        parentNodeId: null,
        name: 'Getting Started',
        slug: 'getting-started',
        nodeType: 'section',
        position: 0,
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Getting Started',
            slug: 'getting-started',
            nodeType: 'section',
            position: 0,
          }),
        },
      );

      await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: authPrincipal,
      });

      expect(assertPermission).toHaveBeenCalledWith(
        authPrincipal,
        'site-1',
        'branch-1',
        'canEdit',
      );
    });

    it('should return 403 when principal lacks permission', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const { assertPermission, AuthorizationError } = await import(
        '../../src/auth/authorization'
      );

      vi.mocked(assertPermission).mockImplementationOnce(() => {
        throw new AuthorizationError(
          'Permission denied',
          'canView',
          'viewer',
        );
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: authPrincipal,
      });

      expect(response.status).toBe(403);
    });
  });

  // ===========================================================================
  // Cross-tenant IDOR protection
  // ===========================================================================

  describe('Cross-tenant IDOR protection', () => {
    it('rejects node listing when branch belongs to a different site', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        branchId: 'branch-1',
        siteId: 'site-OTHER',
        name: 'Navigation',
        slug: 'navigation',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        { method: 'GET' },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
      expect(services.listNodes).not.toHaveBeenCalled();
    });

    it('rejects node creation when branch belongs to a different site', async () => {
      const { handleNodeRoutes } = await import('../../src/routes/node-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce(makeBranch({
        id: 'branch-1',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      }));

      vi.mocked(services.getBranchStructure).mockResolvedValueOnce({
        id: 'struct-1',
        branchId: 'branch-1',
        siteId: 'site-OTHER',
        name: 'Navigation',
        slug: 'navigation',
        structureType: 'hierarchy',
        createdAt: '2026-01-24T10:00:00.000Z',
      });

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/structures/struct-1/nodes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Home',
            slug: 'home',
            nodeType: 'page',
            position: 0,
          }),
        },
      );

      const response = await handleNodeRoutes(request, {
        siteId: 'site-1',
        branchId: 'branch-1',
        structureId: 'struct-1',
        principal: makePrincipal({ id: 'user-1', type: 'user' }),
      });

      expect(response.status).toBe(404);
      expect(services.createNode).not.toHaveBeenCalled();
    });
  });
});
