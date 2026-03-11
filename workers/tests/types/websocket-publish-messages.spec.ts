/**
 * WebSocket Publish Message Types Tests
 *
 * Tests for the WebSocket-driven publish protocol message types.
 * This protocol allows the client to request a publish operation via WebSocket,
 * with the DO handling flush + publish internally. TCP ordering guarantees
 * all preceding CRDT updates are processed before the publish request.
 */

import { describe, it, expect } from 'vitest';
import type {
  WsPublishRequestMessage,
  WsPublishResultMessage,
  WsClientMessage,
  WsServerMessage,
} from '../../src/types/websocket-messages';
import {
  isWsClientMessage,
  isWsPublishRequest,
} from '../../src/types/websocket-messages';

// =============================================================================
// Type Validation Tests
// =============================================================================

describe('WebSocket Publish Message Types', () => {
  describe('Client → Server Messages', () => {
    describe('WsPublishRequestMessage', () => {
      it('should have correct structure for publish request', () => {
        const message: WsPublishRequestMessage = {
          type: 'publish_request',
          requestId: 'req-123',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('publish_request');
        expect(message.requestId).toBe('req-123');
        expect(message.timestamp).toBeGreaterThan(0);
      });

      it('should be included in WsClientMessage union', () => {
        const message: WsClientMessage = {
          type: 'publish_request',
          requestId: 'req-456',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('publish_request');
      });
    });
  });

  describe('Server → Client Messages', () => {
    describe('WsPublishResultMessage', () => {
      it('should have correct structure for successful publish', () => {
        const message: WsPublishResultMessage = {
          type: 'publish_result',
          requestId: 'req-123',
          success: true,
          publishedVersionId: 'version-abc',
          checkpoint: {
            id: 'cp-1',
            branchId: 'branch-1',
            name: 'Publish: document',
            checkpointType: 'publish',
            status: 'completed',
            createdById: 'user-1',
            createdByType: 'user',
            createdAt: new Date().toISOString(),
            documentCount: 1,
          },
          timestamp: Date.now(),
        };

        expect(message.type).toBe('publish_result');
        expect(message.requestId).toBe('req-123');
        expect(message.success).toBe(true);
        expect(message.publishedVersionId).toBe('version-abc');
        expect(message.checkpoint).toBeDefined();
        expect(message.checkpoint?.id).toBe('cp-1');
        expect(message.error).toBeUndefined();
        expect(message.timestamp).toBeGreaterThan(0);
      });

      it('should have correct structure for failed publish', () => {
        const message: WsPublishResultMessage = {
          type: 'publish_result',
          requestId: 'req-123',
          success: false,
          error: 'Document not found',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('publish_result');
        expect(message.success).toBe(false);
        expect(message.error).toBe('Document not found');
        expect(message.publishedVersionId).toBeUndefined();
        expect(message.checkpoint).toBeUndefined();
      });

      it('should be included in WsServerMessage union', () => {
        const message: WsServerMessage = {
          type: 'publish_result',
          requestId: 'req-789',
          success: true,
          timestamp: Date.now(),
        };

        expect(message.type).toBe('publish_result');
      });
    });
  });

  // =============================================================================
  // Type Guard Tests
  // =============================================================================

  describe('Type Guards', () => {
    describe('isWsPublishRequest', () => {
      it('should return true for valid publish request', () => {
        const msg = {
          type: 'publish_request',
          requestId: 'req-123',
          timestamp: Date.now(),
        };

        expect(isWsPublishRequest(msg)).toBe(true);
      });

      it('should return false for missing requestId', () => {
        const msg = {
          type: 'publish_request',
          timestamp: Date.now(),
        };

        expect(isWsPublishRequest(msg)).toBe(false);
      });

      it('should return false for missing timestamp', () => {
        const msg = {
          type: 'publish_request',
          requestId: 'req-123',
        };

        expect(isWsPublishRequest(msg)).toBe(false);
      });

      it('should return false for wrong type', () => {
        const msg = {
          type: 'delivery_ack_request',
          requestId: 'req-123',
          timestamp: Date.now(),
        };

        expect(isWsPublishRequest(msg)).toBe(false);
      });

      it('should return false for null', () => {
        expect(isWsPublishRequest(null)).toBe(false);
      });

      it('should return false for non-object', () => {
        expect(isWsPublishRequest('not an object')).toBe(false);
        expect(isWsPublishRequest(42)).toBe(false);
        expect(isWsPublishRequest(undefined)).toBe(false);
      });

      it('should return false for wrong field types', () => {
        expect(isWsPublishRequest({
          type: 'publish_request',
          requestId: 123,
          timestamp: Date.now(),
        })).toBe(false);

        expect(isWsPublishRequest({
          type: 'publish_request',
          requestId: 'req-123',
          timestamp: 'not a number',
        })).toBe(false);
      });
    });

    describe('isWsClientMessage includes publish_request', () => {
      it('should return true for publish_request', () => {
        const msg = {
          type: 'publish_request',
          requestId: 'req-123',
          timestamp: Date.now(),
        };

        expect(isWsClientMessage(msg)).toBe(true);
      });
    });
  });

  // =============================================================================
  // Serialization Tests
  // =============================================================================

  describe('Serialization', () => {
    it('should round-trip publish_request through JSON', () => {
      const original: WsPublishRequestMessage = {
        type: 'publish_request',
        requestId: 'req-abc',
        timestamp: Date.now(),
      };

      const serialized = JSON.stringify(original);
      const parsed = JSON.parse(serialized) as WsPublishRequestMessage;

      expect(parsed.type).toBe(original.type);
      expect(parsed.requestId).toBe(original.requestId);
      expect(parsed.timestamp).toBe(original.timestamp);
    });

    it('should round-trip publish_result through JSON', () => {
      const original: WsPublishResultMessage = {
        type: 'publish_result',
        requestId: 'req-abc',
        success: true,
        publishedVersionId: 'v-1',
        checkpoint: {
          id: 'cp-1',
          branchId: 'branch-1',
          name: 'Publish: document',
          checkpointType: 'publish',
          status: 'completed',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: new Date().toISOString(),
          documentCount: 1,
        },
        timestamp: Date.now(),
      };

      const serialized = JSON.stringify(original);
      const parsed = JSON.parse(serialized) as WsPublishResultMessage;

      expect(parsed.type).toBe(original.type);
      expect(parsed.requestId).toBe(original.requestId);
      expect(parsed.success).toBe(original.success);
      expect(parsed.publishedVersionId).toBe(original.publishedVersionId);
      expect(parsed.checkpoint?.id).toBe(original.checkpoint?.id);
    });

    it('should support type discrimination in server messages', () => {
      const messages: WsServerMessage[] = [
        { type: 'presence_update', actors: [], timestamp: Date.now() },
        {
          type: 'publish_result',
          requestId: 'req-1',
          success: true,
          timestamp: Date.now(),
        },
      ];

      for (const msg of messages) {
        switch (msg.type) {
          case 'presence_update':
            expect(msg.actors).toBeDefined();
            break;
          case 'publish_result':
            expect(msg.requestId).toBeDefined();
            expect(typeof msg.success).toBe('boolean');
            break;
        }
      }
    });
  });
});
