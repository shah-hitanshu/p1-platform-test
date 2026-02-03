/**
 * WebSocket Presence Message Types Tests
 *
 * Tests for the WebSocket-based presence protocol message types.
 * These enable real-time presence updates over WebSocket instead of HTTP polling.
 *
 * Protocol:
 * - Binary frames: Yjs CRDT updates (existing)
 * - Text frames: JSON presence messages (new)
 */

import { describe, it, expect } from 'vitest';
import type {
  WsFocusRegionUpdateMessage,
  WsPresenceHeartbeatMessage,
  WsPresenceUpdateMessage,
  WsFocusRegionBroadcastMessage,
  WsFocusRegionAckMessage,
  WsPresenceErrorMessage,
  WsClientMessage,
  WsServerMessage,
} from '../../src/types/websocket-messages';
import type { ActorPresence, PresenceState } from '../../src/types';

// =============================================================================
// Type Validation Tests
// =============================================================================

describe('WebSocket Presence Message Types', () => {
  describe('Client → Server Messages', () => {
    describe('WsFocusRegionUpdateMessage', () => {
      it('should have correct structure for focus region update', () => {
        const message: WsFocusRegionUpdateMessage = {
          type: 'focus_region_update',
          focusRegions: ['$.hero', '$.content.blocks[0]'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_update');
        expect(message.focusRegions).toBeInstanceOf(Array);
        expect(message.timestamp).toBeGreaterThan(0);
      });

      it('should support empty focus regions array', () => {
        const message: WsFocusRegionUpdateMessage = {
          type: 'focus_region_update',
          focusRegions: [],
          timestamp: Date.now(),
        };

        expect(message.focusRegions).toHaveLength(0);
      });
    });

    describe('WsPresenceHeartbeatMessage', () => {
      it('should have correct structure for heartbeat without state', () => {
        const message: WsPresenceHeartbeatMessage = {
          type: 'presence_heartbeat',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_heartbeat');
        expect(message.state).toBeUndefined();
        expect(message.timestamp).toBeGreaterThan(0);
      });

      it('should support optional state field', () => {
        const states: PresenceState[] = ['active', 'idle', 'editing'];

        for (const state of states) {
          const message: WsPresenceHeartbeatMessage = {
            type: 'presence_heartbeat',
            state,
            timestamp: Date.now(),
          };

          expect(message.state).toBe(state);
        }
      });
    });

    describe('WsClientMessage union type', () => {
      it('should accept focus_region_update messages', () => {
        const message: WsClientMessage = {
          type: 'focus_region_update',
          focusRegions: ['$.test'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_update');
      });

      it('should accept presence_heartbeat messages', () => {
        const message: WsClientMessage = {
          type: 'presence_heartbeat',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_heartbeat');
      });
    });
  });

  describe('Server → Client Messages', () => {
    describe('WsPresenceUpdateMessage', () => {
      it('should have correct structure for presence update', () => {
        const actors: ActorPresence[] = [
          {
            id: 'presence-1',
            actorId: 'user-1',
            actorType: 'user',
            role: 'human',
            name: 'Test User',
            state: 'editing',
            lastActivityAt: new Date().toISOString(),
            joinedAt: new Date().toISOString(),
          },
        ];

        const message: WsPresenceUpdateMessage = {
          type: 'presence_update',
          actors,
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_update');
        expect(message.actors).toHaveLength(1);
        expect(message.actors[0]?.actorId).toBe('user-1');
        expect(message.timestamp).toBeGreaterThan(0);
      });

      it('should support empty actors array', () => {
        const message: WsPresenceUpdateMessage = {
          type: 'presence_update',
          actors: [],
          timestamp: Date.now(),
        };

        expect(message.actors).toHaveLength(0);
      });
    });

    describe('WsFocusRegionBroadcastMessage', () => {
      it('should have correct structure for focus region broadcast', () => {
        const message: WsFocusRegionBroadcastMessage = {
          type: 'focus_region_broadcast',
          actorId: 'user-1',
          focusRegions: ['$.hero', '$.content'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_broadcast');
        expect(message.actorId).toBe('user-1');
        expect(message.focusRegions).toHaveLength(2);
        expect(message.timestamp).toBeGreaterThan(0);
      });
    });

    describe('WsFocusRegionAckMessage', () => {
      it('should have correct structure for successful ack', () => {
        const message: WsFocusRegionAckMessage = {
          type: 'focus_region_ack',
          success: true,
          focusRegions: ['$.hero'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_ack');
        expect(message.success).toBe(true);
        expect(message.focusRegions).toHaveLength(1);
      });

      it('should have correct structure for failed ack', () => {
        const message: WsFocusRegionAckMessage = {
          type: 'focus_region_ack',
          success: false,
          focusRegions: [],
          timestamp: Date.now(),
        };

        expect(message.success).toBe(false);
      });
    });

    describe('WsPresenceErrorMessage', () => {
      it('should have correct structure for error message', () => {
        const message: WsPresenceErrorMessage = {
          type: 'presence_error',
          code: 'PARSE_ERROR',
          message: 'Invalid message format',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_error');
        expect(message.code).toBe('PARSE_ERROR');
        expect(message.message).toBe('Invalid message format');
        expect(message.timestamp).toBeGreaterThan(0);
      });
    });

    describe('WsServerMessage union type', () => {
      it('should accept presence_update messages', () => {
        const message: WsServerMessage = {
          type: 'presence_update',
          actors: [],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_update');
      });

      it('should accept focus_region_broadcast messages', () => {
        const message: WsServerMessage = {
          type: 'focus_region_broadcast',
          actorId: 'user-1',
          focusRegions: [],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_broadcast');
      });

      it('should accept focus_region_ack messages', () => {
        const message: WsServerMessage = {
          type: 'focus_region_ack',
          success: true,
          focusRegions: [],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_ack');
      });

      it('should accept presence_error messages', () => {
        const message: WsServerMessage = {
          type: 'presence_error',
          code: 'INVALID_REGIONS',
          message: 'Invalid focus regions',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_error');
      });
    });
  });

  describe('Message Parsing', () => {
    it('should be JSON-serializable and deserializable', () => {
      const original: WsFocusRegionUpdateMessage = {
        type: 'focus_region_update',
        focusRegions: ['$.hero', '$.content.blocks[0]'],
        timestamp: Date.now(),
      };

      const serialized = JSON.stringify(original);
      const parsed = JSON.parse(serialized) as WsFocusRegionUpdateMessage;

      expect(parsed.type).toBe(original.type);
      expect(parsed.focusRegions).toEqual(original.focusRegions);
      expect(parsed.timestamp).toBe(original.timestamp);
    });

    it('should support type discrimination via type field', () => {
      const messages: WsServerMessage[] = [
        { type: 'presence_update', actors: [], timestamp: Date.now() },
        { type: 'focus_region_broadcast', actorId: 'user-1', focusRegions: [], timestamp: Date.now() },
        { type: 'focus_region_ack', success: true, focusRegions: [], timestamp: Date.now() },
        { type: 'presence_error', code: 'TEST', message: 'test', timestamp: Date.now() },
      ];

      for (const msg of messages) {
        // Type narrowing should work based on 'type' field
        switch (msg.type) {
          case 'presence_update':
            expect(msg.actors).toBeDefined();
            break;
          case 'focus_region_broadcast':
            expect(msg.actorId).toBeDefined();
            break;
          case 'focus_region_ack':
            expect(typeof msg.success).toBe('boolean');
            break;
          case 'presence_error':
            expect(msg.code).toBeDefined();
            break;
        }
      }
    });
  });
});
