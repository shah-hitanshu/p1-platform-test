/**
 * Phase 7.1.1b: Node API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for structure node operations.
 * Nodes are associated with structures, which are branch-scoped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services
vi.mock('../../src/services', () => ({
  createNode: vi.fn(),
  getNode: vi.fn(),
  listNodes: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  moveNode: vi.fn(),
  reorderNodes: vi.fn(),
  buildNavigationTree: vi.fn(),
  getBranchStructure: vi.fn(),
  StructureNotFoundError: class StructureNotFoundError extends Error {
    override name = 'StructureNotFoundError';
    constructor(public structureId: string) {
      super(`Structure not found: ${structureId}`);
    }
  },
  NodeNotFoundError: class NodeNotFoundError extends Error {
    override name = 'NodeNotFoundError';
    constructor(public nodeId: string) {
      super(`Node not found: ${nodeId}`);
    }
  },
  DuplicateNodeSlugError: class DuplicateNodeSlugError extends Error {
    override name = 'DuplicateNodeSlugError';
    constructor(
      public structureId: string,
      public slug: string,
    ) {
      super(`Node with slug "${slug}" already exists in structure`);
    }
  },
  CircularReferenceError: class CircularReferenceError extends Error {
    override name = 'CircularReferenceError';
    constructor() {
      super('Move would create circular reference');
    }
  },
}));

// Mock authorization
vi.mock('../../src/auth/middleware', () => ({
  requirePermission: vi.fn(() => vi.fn()),
}));

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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(201);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(400);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(409);
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(404);
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
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
        principal: { id: 'user-1', type: 'user' },
      });

      expect(response.status).toBe(500);
    });
  });
});
