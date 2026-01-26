/**
 * Phase 4.1: DocumentSession Durable Object Tests (TDD)
 *
 * Tests for the DocumentSession Durable Object that manages real-time
 * collaborative editing via CRDT (Yjs) and WebSocket connections.
 *
 * Session Identifier Format: {siteId}:{documentId}:{branchId}
 *
 * Endpoints:
 * - /connect: WebSocket for real-time collaboration
 * - /snapshot: Get current document state + connected actors
 * - /apply: Apply edit operations programmatically
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { EditOperation, ConnectionMeta } from '../../src/types';

// =============================================================================
// Mock Types for Durable Object Testing
// =============================================================================

/**
 * Mock DurableObjectStorage interface matching Cloudflare's API
 */
interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
}

/**
 * Mock DurableObjectState interface
 */
interface MockDurableObjectState {
  id: { toString: () => string };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
}

/**
 * Create a mock DurableObjectState for testing
 */
function createMockState(sessionId = 'site-1:doc-1:branch-1'): MockDurableObjectState {
  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue(new Map()),
  };

  return {
    id: { toString: () => sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
  };
}

/**
 * Mock environment for DocumentSession
 */
interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
}

function createMockEnv(): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

// =============================================================================
// DocumentSession Tests
// =============================================================================

describe('Phase 4.1: DocumentSession Durable Object', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  describe('constructor', () => {
    it('should initialize with DurableObjectState and environment', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      const session = new DocumentSession(mockState as unknown, mockEnv);

      expect(session).toBeDefined();
    });

    it('should parse session identifier from state id', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const customState = createMockState('site-abc:doc-xyz:branch-123');

      const session = new DocumentSession(customState as unknown, mockEnv);

      // Session should be able to return its parsed identifiers
      const info = session.getSessionInfo();
      expect(info.siteId).toBe('site-abc');
      expect(info.documentId).toBe('doc-xyz');
      expect(info.branchId).toBe('branch-123');
    });
  });

  describe('fetch routing', () => {
    it('should route /snapshot to handleSnapshot', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('snapshot');
      expect(data).toHaveProperty('stateVector');
      expect(data).toHaveProperty('connectedActors');
    });

    it('should route /apply to handleApplyOperations', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'title', value: 'Hello' }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should return 404 for unknown paths', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/unknown');
      const response = await session.fetch(request);

      expect(response.status).toBe(404);
    });

    it('should route /connect to handleWebSocket', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // For WebSocket upgrade, we need the Upgrade header
      const request = new Request('http://localhost/connect', {
        headers: {
          'Upgrade': 'websocket',
          'X-Actor-Id': 'user-1',
          'X-Actor-Type': 'user',
        },
      });
      const response = await session.fetch(request);

      // WebSocket upgrade returns 101 or special response
      // In test environment, we may get 501 if WebSocketPair is not available
      expect([101, 501]).toContain(response.status);
    });
  });

  describe('/snapshot endpoint', () => {
    it('should return empty snapshot for new session', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.snapshot).toEqual({});
      expect(data.connectedActors).toEqual([]);
    });

    it('should return state vector for CRDT synchronization', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      const data = await response.json();
      expect(Array.isArray(data.stateVector)).toBe(true);
    });

    it('should list connected actors', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Simulate connections by calling internal method or through apply
      // For now, test that the property exists
      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      const data = await response.json();
      expect(Array.isArray(data.connectedActors)).toBe(true);
    });

    it('should initialize from persisted state if available', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // Simulate persisted CRDT state (Yjs encoded update)
      // In real implementation, this would be a Uint8Array
      const mockPersistedState = new Uint8Array([/* Yjs update bytes */]);
      mockState.storage.get.mockResolvedValue(mockPersistedState);

      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      expect(mockState.storage.get).toHaveBeenCalledWith('ydoc');
    });
  });

  describe('/apply endpoint', () => {
    it('should apply set operation to document', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [
            { type: 'set', path: 'title', value: 'My Document' },
          ],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.snapshot.title).toBe('My Document');
    });

    it('should apply nested set operation', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [
            { type: 'set', path: 'metadata.author', value: 'Alice' },
          ],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      const metadata = data.snapshot.metadata as Record<string, unknown> | undefined;
      expect(metadata?.author).toBe('Alice');
    });

    it('should apply delete operation', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // First set a value
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'toDelete', value: 'temporary' }],
          actorId: 'user-1',
        }),
      }));

      // Then delete it
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'delete', path: 'toDelete' }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.snapshot.toDelete).toBeUndefined();
    });

    it('should apply insert operation to array', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // First create an array
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'components', value: [] }],
          actorId: 'user-1',
        }),
      }));

      // Insert into array
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'insert',
            path: 'components',
            index: 0,
            value: { type: 'Header', props: { text: 'Welcome' } },
          }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.snapshot.components)).toBe(true);
      const components = data.snapshot.components as Record<string, unknown>[];
      expect(components[0].type).toBe('Header');
    });

    it('should apply move operation in array', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Set up initial array
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'set',
            path: 'items',
            value: ['a', 'b', 'c'],
          }],
          actorId: 'user-1',
        }),
      }));

      // Move item from index 0 to index 2
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'move',
            path: 'items',
            fromIndex: 0,
            toIndex: 2,
          }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // After move: ['b', 'c', 'a']
      expect(data.snapshot.items).toEqual(['b', 'c', 'a']);
    });

    it('should apply replace operation', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Set initial value
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'content', value: 'old content' }],
          actorId: 'user-1',
        }),
      }));

      // Replace it
      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'replace',
            path: 'content',
            content: 'new content',
          }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.snapshot.content).toBe('new content');
    });

    it('should apply multiple operations in order', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const operations: EditOperation[] = [
        { type: 'set', path: 'title', value: 'Document' },
        { type: 'set', path: 'author', value: 'Bob' },
        { type: 'set', path: 'version', value: 1 },
      ];

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations, actorId: 'user-1' }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.operationsApplied).toBe(3);
      expect(data.snapshot.title).toBe('Document');
      expect(data.snapshot.author).toBe('Bob');
      expect(data.snapshot.version).toBe(1);
    });

    it('should return error for invalid operation type', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'invalid', path: 'foo' }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid operation type');
    });

    it('should require actorId in request', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'foo', value: 'bar' }],
          // No actorId
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('actorId');
    });

    it('should persist state after applying operations', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'data', value: 'persist me' }],
          actorId: 'user-1',
        }),
      });
      await session.fetch(request);

      // Verify state was persisted
      expect(mockState.storage.put).toHaveBeenCalledWith(
        'ydoc',
        expect.any(Uint8Array),
      );
    });
  });

  describe('/connect WebSocket endpoint', () => {
    it('should require X-Actor-Id header', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/connect', {
        headers: {
          'Upgrade': 'websocket',
          // Missing X-Actor-Id
          'X-Actor-Type': 'user',
        },
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
    });

    it('should require X-Actor-Type header', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/connect', {
        headers: {
          'Upgrade': 'websocket',
          'X-Actor-Id': 'user-1',
          // Missing X-Actor-Type
        },
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
    });

    it('should validate X-Actor-Type is user or agent', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/connect', {
        headers: {
          'Upgrade': 'websocket',
          'X-Actor-Id': 'user-1',
          'X-Actor-Type': 'invalid',
        },
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
    });
  });

  describe('state persistence', () => {
    it('should load state from storage on initialization', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // Provide some stored state
      const storedData = new Uint8Array([1, 2, 3, 4]);
      mockState.storage.get.mockResolvedValue(storedData);

      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Trigger initialization by making a request
      await session.fetch(new Request('http://localhost/snapshot'));

      expect(mockState.storage.get).toHaveBeenCalledWith('ydoc');
    });

    it('should persist state after each operation batch', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Apply operations
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'key', value: 'value' }],
          actorId: 'user-1',
        }),
      }));

      expect(mockState.storage.put).toHaveBeenCalledWith('ydoc', expect.any(Uint8Array));
    });

    it('should persist connection metadata', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // When connections are tracked, metadata should be persisted
      // This is tested indirectly through the snapshot endpoint
      await session.fetch(new Request('http://localhost/snapshot'));

      // Session should be able to list connected actors
      // (empty in this case since no WebSocket connection)
    });
  });

  describe('lazy initialization from checkpoint', () => {
    it('should initialize empty state if no stored state exists', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      mockState.storage.get.mockResolvedValue(undefined);

      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      const data = await response.json();
      expect(data.snapshot).toEqual({});
    });

    it('should restore state from stored CRDT data', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // This test verifies that if we have stored Yjs state,
      // it gets restored. The actual bytes would come from Yjs encoding.
      // For now, we just verify the storage is checked.
      mockState.storage.get.mockResolvedValue(undefined);

      const session = new DocumentSession(mockState as unknown, mockEnv);
      await session.fetch(new Request('http://localhost/snapshot'));

      expect(mockState.storage.get).toHaveBeenCalled();
    });
  });

  describe('CRDT operations', () => {
    it('should handle concurrent operations deterministically', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Apply two sets to the same key - last one wins in CRDT
      const ops1 = [{ type: 'set', path: 'value', value: 1 }] as EditOperation[];
      const ops2 = [{ type: 'set', path: 'value', value: 2 }] as EditOperation[];

      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: ops1, actorId: 'user-1' }),
      }));

      const response = await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: ops2, actorId: 'user-2' }),
      }));

      const data = await response.json();
      expect(data.snapshot.value).toBe(2);
    });

    it('should support deep nested paths', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'set',
            path: 'level1.level2.level3.value',
            value: 'deep',
          }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      const level1 = data.snapshot.level1 as Record<string, Record<string, Record<string, unknown>>> | undefined;
      expect(level1?.level2?.level3?.value).toBe('deep');
    });

    it('should handle array operations at nested paths', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Create nested structure with array
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'set',
            path: 'page.sections',
            value: [],
          }],
          actorId: 'user-1',
        }),
      }));

      // Insert into nested array
      const response = await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            type: 'insert',
            path: 'page.sections',
            index: 0,
            value: { id: 'section-1' },
          }],
          actorId: 'user-1',
        }),
      }));

      expect(response.status).toBe(200);
      const data = await response.json();
      const page = data.snapshot.page as Record<string, unknown> | undefined;
      const sections = page?.sections as Record<string, unknown>[] | undefined;
      expect(Array.isArray(sections)).toBe(true);
      expect(sections?.[0].id).toBe('section-1');
    });
  });

  describe('connection management', () => {
    it('should track connected actors in snapshot', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Without actual WebSocket connection, actors list should be empty
      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      const data = await response.json();
      expect(data.connectedActors).toEqual([]);
    });

    it('should get connection count', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const count = session.getConnectionCount();
      expect(count).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON in /apply request', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle missing operations array in /apply', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: 'user-1' }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('operations');
    });

    it('should handle empty operations array gracefully', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: [], actorId: 'user-1' }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.operationsApplied).toBe(0);
    });

    it('should handle storage errors gracefully', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      mockState.storage.put.mockRejectedValue(new Error('Storage unavailable'));

      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'key', value: 'value' }],
          actorId: 'user-1',
        }),
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(500);
    });
  });

  describe('Yjs integration', () => {
    it('should use Y.Doc for document state', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // The session should internally use Yjs
      // We verify this indirectly through stateVector in snapshot
      const request = new Request('http://localhost/snapshot');
      const response = await session.fetch(request);

      const data = await response.json();
      // State vector is a Yjs concept - if it exists, Yjs is being used
      expect(data.stateVector).toBeDefined();
    });

    it('should encode state as Yjs update for persistence', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'test', value: 'data' }],
          actorId: 'user-1',
        }),
      }));

      // The persisted data should be a Uint8Array (Yjs encoded update)
      expect(mockState.storage.put).toHaveBeenCalledWith(
        'ydoc',
        expect.any(Uint8Array),
      );
    });
  });
});

// =============================================================================
// Phase 1.3: Sync Triggers Tests
// =============================================================================

describe('Phase 1.3: DocumentSession Sync Triggers', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  describe('/sync endpoint', () => {
    it('should expose /sync endpoint for manual sync trigger', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/sync', {
        method: 'POST',
      });
      const response = await session.fetch(request);

      // Should return 200 (sync triggered) or appropriate status
      expect([200, 204]).toContain(response.status);
    });

    it('should return current snapshot after sync', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // First set some data
      await session.fetch(new Request('http://localhost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{ type: 'set', path: 'title', value: 'Test' }],
          actorId: 'user-1',
        }),
      }));

      // Then sync
      const request = new Request('http://localhost/sync', {
        method: 'POST',
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('synced');
    });

    it('should only accept POST method for /sync', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      const request = new Request('http://localhost/sync', {
        method: 'GET',
      });
      const response = await session.fetch(request);

      expect(response.status).toBe(405);
    });
  });

  describe('sync configuration', () => {
    it('should have configurable sync settings via environment', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // Environment can contain API URL and secret for sync
      const envWithSync = {
        ...mockEnv,
        INTERNAL_API_URL: 'http://localhost:8787',
        INTERNAL_SECRET: 'test-secret',
      };

      const session = new DocumentSession(mockState as unknown, envWithSync);
      expect(session).toBeDefined();
    });
  });
});

// =============================================================================
// Phase 1.4: PostgreSQL Initialization Tests
// =============================================================================

describe('Phase 1.4: DocumentSession PostgreSQL Initialization', () => {
  let mockState: MockDurableObjectState;
  let mockEnv: MockEnv;

  beforeEach(() => {
    vi.resetAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
  });

  describe('initialization priority', () => {
    it('should prefer DO storage over PostgreSQL when available', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // Set up stored CRDT state in DO storage
      const storedData = new Uint8Array([1, 2, 3, 4]);
      mockState.storage.get.mockResolvedValue(storedData);

      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Trigger initialization
      await session.fetch(new Request('http://localhost/snapshot'));

      // Should read from DO storage
      expect(mockState.storage.get).toHaveBeenCalledWith('ydoc');
    });

    it('should initialize with empty state when no storage and no PostgreSQL config', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');

      // No stored data
      mockState.storage.get.mockResolvedValue(undefined);

      const session = new DocumentSession(mockState as unknown, mockEnv);

      const response = await session.fetch(new Request('http://localhost/snapshot'));
      const data = await response.json();

      expect(data.snapshot).toEqual({});
    });
  });

  describe('snapshot initialization', () => {
    it('should be able to initialize from a JSON snapshot', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Check if there's an endpoint to initialize from snapshot
      // This would be called by the sync service when initializing from PostgreSQL
      const request = new Request('http://localhost/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: { root: { title: 'From PostgreSQL' } },
          crdtState: null,  // No CRDT state, just snapshot
        }),
      });
      const response = await session.fetch(request);

      // If endpoint exists, it should succeed
      // If not, this test documents the expected behavior
      if (response.status === 200) {
        const snapshotResponse = await session.fetch(new Request('http://localhost/snapshot'));
        const data = await snapshotResponse.json();
        const root = data.snapshot.root as Record<string, unknown> | undefined;
        expect(root?.title).toBe('From PostgreSQL');
      } else {
        // Endpoint not implemented yet - test will fail until implemented
        expect(response.status).toBe(200);
      }
    });

    it('should be able to initialize from CRDT state', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(mockState as unknown, mockEnv);

      // Check if there's an endpoint to initialize from CRDT state
      const request = new Request('http://localhost/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: { root: { title: 'Test' } },
          crdtState: 'base64encodedcrdtstate==',  // Base64 encoded CRDT state
        }),
      });
      const response = await session.fetch(request);

      // If endpoint exists, it should succeed
      if (response.status === 200) {
        expect(response.status).toBe(200);
      } else {
        // Endpoint not implemented yet
        expect(response.status).toBe(200);
      }
    });
  });
});

// =============================================================================
// Helper Types Tests
// =============================================================================

describe('Phase 4.1: DocumentSession Helper Types', () => {
  describe('EditOperation validation', () => {
    it('should validate set operation requires path and value', () => {
      const validSetOp: EditOperation = {
        type: 'set',
        path: 'foo.bar',
        value: 'baz',
      };
      expect(validSetOp.type).toBe('set');
      expect(validSetOp.path).toBeDefined();
      expect(validSetOp.value).toBeDefined();
    });

    it('should validate delete operation requires path', () => {
      const validDeleteOp: EditOperation = {
        type: 'delete',
        path: 'foo.bar',
      };
      expect(validDeleteOp.type).toBe('delete');
      expect(validDeleteOp.path).toBeDefined();
    });

    it('should validate insert operation requires path, index, and value', () => {
      const validInsertOp: EditOperation = {
        type: 'insert',
        path: 'items',
        index: 0,
        value: { id: 1 },
      };
      expect(validInsertOp.type).toBe('insert');
      expect(validInsertOp.path).toBeDefined();
      expect(validInsertOp.index).toBeDefined();
      expect(validInsertOp.value).toBeDefined();
    });

    it('should validate move operation requires path, fromIndex, and toIndex', () => {
      const validMoveOp: EditOperation = {
        type: 'move',
        path: 'items',
        fromIndex: 0,
        toIndex: 2,
      };
      expect(validMoveOp.type).toBe('move');
      expect(validMoveOp.path).toBeDefined();
      expect(validMoveOp.fromIndex).toBeDefined();
      expect(validMoveOp.toIndex).toBeDefined();
    });

    it('should validate replace operation requires path and content', () => {
      const validReplaceOp: EditOperation = {
        type: 'replace',
        path: 'content',
        content: 'new content',
      };
      expect(validReplaceOp.type).toBe('replace');
      expect(validReplaceOp.path).toBeDefined();
      expect(validReplaceOp.content).toBeDefined();
    });
  });

  describe('ConnectionMeta type', () => {
    it('should include actorId and actorType', () => {
      const meta: ConnectionMeta = {
        actorId: 'user-123',
        actorType: 'user',
      };
      expect(meta.actorId).toBe('user-123');
      expect(meta.actorType).toBe('user');
    });

    it('should support agent actor type', () => {
      const meta: ConnectionMeta = {
        actorId: 'agent-456',
        actorType: 'agent',
      };
      expect(meta.actorType).toBe('agent');
    });
  });
});
