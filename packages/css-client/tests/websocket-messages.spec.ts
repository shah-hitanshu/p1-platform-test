/**
 * WebSocket Presence Message Types Tests
 *
 * Tests for the WebSocket presence protocol message types used for
 * real-time presence updates over the existing WebSocket connection.
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
} from '../src/types';
import type { ActorPresence, ActorState } from '../src/types';

describe('WebSocket Presence Message Types', () => {
  describe('Client → Server Messages', () => {
    describe('WsFocusRegionUpdateMessage', () => {
      it('should have correct structure', () => {
        const message: WsFocusRegionUpdateMessage = {
          type: 'focus_region_update',
          focusRegions: ['$.hero', '$.content.blocks[0]'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_update');
        expect(message.focusRegions).toEqual(['$.hero', '$.content.blocks[0]']);
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
      it('should have correct structure without state', () => {
        const message: WsPresenceHeartbeatMessage = {
          type: 'presence_heartbeat',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_heartbeat');
        expect(message.state).toBeUndefined();
      });

      it('should support optional state field', () => {
        const states: ActorState[] = ['active', 'idle', 'editing'];

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
      it('should have correct structure', () => {
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
      });
    });

    describe('WsFocusRegionBroadcastMessage', () => {
      it('should have correct structure', () => {
        const message: WsFocusRegionBroadcastMessage = {
          type: 'focus_region_broadcast',
          actorId: 'user-1',
          focusRegions: ['$.hero', '$.content'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_broadcast');
        expect(message.actorId).toBe('user-1');
        expect(message.focusRegions).toHaveLength(2);
      });
    });

    describe('WsFocusRegionAckMessage', () => {
      it('should have correct structure for success', () => {
        const message: WsFocusRegionAckMessage = {
          type: 'focus_region_ack',
          success: true,
          focusRegions: ['$.hero'],
          timestamp: Date.now(),
        };

        expect(message.type).toBe('focus_region_ack');
        expect(message.success).toBe(true);
      });

      it('should have correct structure for failure', () => {
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
      it('should have correct structure', () => {
        const message: WsPresenceErrorMessage = {
          type: 'presence_error',
          code: 'PARSE_ERROR',
          message: 'Invalid message format',
          timestamp: Date.now(),
        };

        expect(message.type).toBe('presence_error');
        expect(message.code).toBe('PARSE_ERROR');
        expect(message.message).toBe('Invalid message format');
      });
    });

    describe('WsServerMessage union type', () => {
      it('should support type discrimination', () => {
        const messages: WsServerMessage[] = [
          { type: 'presence_update', actors: [], timestamp: Date.now() },
          { type: 'focus_region_broadcast', actorId: 'user-1', focusRegions: [], timestamp: Date.now() },
          { type: 'focus_region_ack', success: true, focusRegions: [], timestamp: Date.now() },
          { type: 'presence_error', code: 'TEST', message: 'test', timestamp: Date.now() },
        ];

        for (const msg of messages) {
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

  describe('JSON Serialization', () => {
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
  });
});
