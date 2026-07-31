/**
 * Agent Politeness System - Phase 7.1: Agent Context Parser Tests (TDD)
 *
 * Tests for parsing and validating X-Agent-* headers from API requests.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * Headers:
 * - X-Agent-Id: <agent-uuid>
 * - X-Agent-Trigger: human_requested | autonomous
 * - X-Agent-Requested-By: <user-uuid> (when human_requested)
 * - X-Agent-Intent: <description of what agent is doing>
 * - X-Agent-Operation-Type: <category>
 * - X-Agent-Target-Regions: <comma-separated JSON paths>
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';

describe('Agent Politeness Phase 7.1: Agent Context Parser', () => {
  describe('parseAgentContext', () => {
    describe('basic parsing', () => {
      it('should return null when no agent headers are present', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers();

        const result = parseAgentContext(headers);

        expect(result).toBeNull();
      });

      it('should parse minimal agent context with only X-Agent-Id', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        });

        const result = parseAgentContext(headers);

        expect(result).not.toBeNull();
        expect(result?.agentId).toBe('44444444-4444-4444-4444-444444444444');
        expect(result?.trigger).toBeUndefined();
      });

      it('should parse full agent context with all headers', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
          'X-Agent-Trigger': 'human_requested',
          'X-Agent-Requested-By': '11111111-1111-1111-1111-111111111111',
          'X-Agent-Intent': 'Updating homepage content',
          'X-Agent-Operation-Type': 'content_edit',
          'X-Agent-Target-Regions': '/content/header,/content/body',
        });

        const result = parseAgentContext(headers);

        expect(result).not.toBeNull();
        expect(result?.agentId).toBe('44444444-4444-4444-4444-444444444444');
        expect(result?.trigger).toBe('human_requested');
        expect(result?.requestedById).toBe('11111111-1111-1111-1111-111111111111');
        expect(result?.intent).toBe('Updating homepage content');
        expect(result?.operationType).toBe('content_edit');
        expect(result?.targetRegions).toEqual(['/content/header', '/content/body']);
      });

      it('should parse autonomous trigger correctly', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
          'X-Agent-Trigger': 'autonomous',
          'X-Agent-Intent': 'Scheduled content refresh',
        });

        const result = parseAgentContext(headers);

        expect(result?.trigger).toBe('autonomous');
        expect(result?.requestedById).toBeUndefined();
      });

      it('should handle empty target regions string', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
          'X-Agent-Target-Regions': '',
        });

        const result = parseAgentContext(headers);

        expect(result?.targetRegions).toEqual([]);
      });

      it('should trim whitespace from target regions', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
          'X-Agent-Target-Regions': ' /content/header , /content/body ',
        });

        const result = parseAgentContext(headers);

        expect(result?.targetRegions).toEqual(['/content/header', '/content/body']);
      });

      it('should be case-insensitive for header names', async () => {
        const { parseAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'x-agent-id': '44444444-4444-4444-4444-444444444444',
          'x-agent-trigger': 'autonomous',
        });

        const result = parseAgentContext(headers);

        expect(result?.agentId).toBe('44444444-4444-4444-4444-444444444444');
        expect(result?.trigger).toBe('autonomous');
      });
    });

    describe('hasAgentContext helper', () => {
      it('should return false when no agent headers present', async () => {
        const { hasAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers();

        expect(hasAgentContext(headers)).toBe(false);
      });

      it('should return true when X-Agent-Id header is present', async () => {
        const { hasAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const headers = new Headers({
          'X-Agent-Id': '44444444-4444-4444-4444-444444444444',
        });

        expect(hasAgentContext(headers)).toBe(true);
      });
    });
  });

  describe('validateAgentContext', () => {
    describe('agentId validation', () => {
      it('should reject empty agentId', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '',
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('agentId is required');
      });

      it('should reject agentId exceeding max length', async () => {
        const { validateAgentContext, MAX_AGENT_ID_LENGTH } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: 'a'.repeat(MAX_AGENT_ID_LENGTH + 1),
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`agentId exceeds maximum length of ${String(MAX_AGENT_ID_LENGTH)}`);
      });

      it('should reject agentId with invalid characters', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: 'agent<script>',
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('agentId contains invalid characters');
      });

      it('should accept valid UUID agentId', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('trigger validation', () => {
      it('should reject invalid trigger value', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          trigger: 'invalid' as 'human_requested' | 'autonomous',
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('trigger must be "human_requested" or "autonomous"');
      });

      it('should accept human_requested trigger with requestedById', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          trigger: 'human_requested' as const,
          requestedById: '11111111-1111-1111-1111-111111111111',
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
      });

      it('should accept autonomous trigger', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          trigger: 'autonomous' as const,
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
      });
    });

    describe('requestedById validation', () => {
      it('should require requestedById when trigger is human_requested', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          trigger: 'human_requested' as const,
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('requestedById is required when trigger is human_requested');
      });

      it('should accept human_requested with valid requestedById', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          trigger: 'human_requested' as const,
          requestedById: '11111111-1111-1111-1111-111111111111',
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
      });

      it('should not require requestedById when trigger is autonomous', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          trigger: 'autonomous' as const,
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('intent validation', () => {
      it('should reject intent exceeding max length', async () => {
        const { validateAgentContext, MAX_INTENT_LENGTH } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          intent: 'a'.repeat(MAX_INTENT_LENGTH + 1),
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`intent exceeds maximum length of ${String(MAX_INTENT_LENGTH)}`);
      });

      it('should accept intent within max length', async () => {
        const { validateAgentContext, MAX_INTENT_LENGTH } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          intent: 'a'.repeat(MAX_INTENT_LENGTH),
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
      });
    });

    describe('operationType validation', () => {
      it('should reject operationType exceeding max length', async () => {
        const { validateAgentContext, MAX_OPERATION_TYPE_LENGTH } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          operationType: 'a'.repeat(MAX_OPERATION_TYPE_LENGTH + 1),
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`operationType exceeds maximum length of ${String(MAX_OPERATION_TYPE_LENGTH)}`);
      });

      it('should accept common operation types', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const operationTypes = ['content_edit', 'structure_edit', 'metadata_edit', 'bulk_operation'];

        for (const operationType of operationTypes) {
          const context = {
            agentId: '44444444-4444-4444-4444-444444444444',
            operationType,
          };

          const result = validateAgentContext(context);
          expect(result.valid).toBe(true);
        }
      });
    });

    describe('targetRegions validation', () => {
      it('should reject too many target regions', async () => {
        const { validateAgentContext, MAX_TARGET_REGIONS } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          targetRegions: Array(MAX_TARGET_REGIONS + 1).fill('/content/0'),
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`targetRegions exceeds maximum count of ${String(MAX_TARGET_REGIONS)}`);
      });

      it('should reject target region path exceeding max length', async () => {
        const { validateAgentContext, MAX_REGION_PATH_LENGTH } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          targetRegions: ['/' + 'a'.repeat(MAX_REGION_PATH_LENGTH)],
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        const expectedError = `targetRegion path exceeds maximum length of ${String(MAX_REGION_PATH_LENGTH)}`;
        expect(result.errors).toContain(expectedError);
      });

      it('should accept valid target regions', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          targetRegions: ['/content/header', '/content/body/0/props'],
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
      });

      it('should accept empty target regions array', async () => {
        const { validateAgentContext } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '44444444-4444-4444-4444-444444444444',
          targetRegions: [],
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(true);
      });
    });

    describe('multiple validation errors', () => {
      it('should collect all validation errors', async () => {
        const { validateAgentContext, MAX_INTENT_LENGTH, MAX_TARGET_REGIONS } = await import(
          '../../src/services/agent-context-service'
        );
        const context = {
          agentId: '',
          trigger: 'invalid' as 'human_requested' | 'autonomous',
          intent: 'a'.repeat(MAX_INTENT_LENGTH + 1),
          targetRegions: Array(MAX_TARGET_REGIONS + 1).fill('/content/0'),
        };

        const result = validateAgentContext(context);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
      });
    });
  });

  describe('AgentContext type', () => {
    it('should export AgentContext interface', async () => {
      const module = await import('../../src/services/agent-context-service');

      // Verify parseAgentContext returns the correct type
      expect(typeof module.parseAgentContext).toBe('function');
      expect(module).toBeDefined();
    });

    it('should export AgentContextValidationResult interface', async () => {
      const module = await import('../../src/services/agent-context-service');

      // Verify validateAgentContext returns the correct type
      expect(typeof module.validateAgentContext).toBe('function');
      expect(module).toBeDefined();
    });
  });

  describe('constants', () => {
    it('should export MAX_AGENT_ID_LENGTH constant', async () => {
      const { MAX_AGENT_ID_LENGTH } = await import(
        '../../src/services/agent-context-service'
      );

      expect(typeof MAX_AGENT_ID_LENGTH).toBe('number');
      expect(MAX_AGENT_ID_LENGTH).toBeGreaterThan(0);
    });

    it('should export MAX_INTENT_LENGTH constant', async () => {
      const { MAX_INTENT_LENGTH } = await import(
        '../../src/services/agent-context-service'
      );

      expect(typeof MAX_INTENT_LENGTH).toBe('number');
      expect(MAX_INTENT_LENGTH).toBeGreaterThan(0);
    });

    it('should export MAX_OPERATION_TYPE_LENGTH constant', async () => {
      const { MAX_OPERATION_TYPE_LENGTH } = await import(
        '../../src/services/agent-context-service'
      );

      expect(typeof MAX_OPERATION_TYPE_LENGTH).toBe('number');
      expect(MAX_OPERATION_TYPE_LENGTH).toBeGreaterThan(0);
    });

    it('should export MAX_TARGET_REGIONS constant', async () => {
      const { MAX_TARGET_REGIONS } = await import(
        '../../src/services/agent-context-service'
      );

      expect(typeof MAX_TARGET_REGIONS).toBe('number');
      expect(MAX_TARGET_REGIONS).toBeGreaterThan(0);
    });

    it('should export MAX_REGION_PATH_LENGTH constant', async () => {
      const { MAX_REGION_PATH_LENGTH } = await import(
        '../../src/services/agent-context-service'
      );

      expect(typeof MAX_REGION_PATH_LENGTH).toBe('number');
      expect(MAX_REGION_PATH_LENGTH).toBeGreaterThan(0);
    });
  });
});
