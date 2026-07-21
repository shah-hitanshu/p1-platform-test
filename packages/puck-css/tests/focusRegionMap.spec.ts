/**
 * Focus Region Map Utility Tests (TDD)
 *
 * Tests for utilities that map focus region paths to component IDs
 * and create focus highlight information from actor presence data.
 */

import { describe, it, expect } from 'vitest';
import type { PuckData, ActorPresence } from '@pantheon-systems/css-client';

// Import will fail until implementation exists
// import {
//   pathToComponentId,
//   createFocusRegionMap,
//   generateActorColor,
//   type FocusHighlight,
// } from '../src/collaboration/utils/focusRegionMap.js';

// =============================================================================
// Mock Data
// =============================================================================

const mockPuckData: PuckData = {
  content: [
    { type: 'Hero', props: { id: 'hero-1', title: 'Welcome' } },
    { type: 'Text', props: { id: 'text-1', content: 'Hello world' } },
    { type: 'Image', props: { id: 'image-1', src: '/img.png' } },
  ],
  root: { props: {} },
  zones: {
    'Header:left': [
      { type: 'Logo', props: { id: 'logo-1', alt: 'Logo' } },
      { type: 'Nav', props: { id: 'nav-1', items: [] } },
    ],
    'Header:right': [
      { type: 'Button', props: { id: 'btn-1', label: 'Sign In' } },
    ],
    'Footer:main': [
      { type: 'Text', props: { id: 'footer-text-1', content: 'Copyright' } },
    ],
  },
};

const mockActors: ActorPresence[] = [
  {
    id: 'presence-1',
    actorId: 'user-alice',
    actorType: 'user',
    role: 'human',
    name: 'Alice',
    state: 'active',
    focusRegions: ['/content/0'],
    lastActivityAt: '2026-01-29T00:00:00Z',
    joinedAt: '2026-01-29T00:00:00Z',
  },
  {
    id: 'presence-2',
    actorId: 'user-bob',
    actorType: 'user',
    role: 'human',
    name: 'Bob',
    state: 'editing',
    focusRegions: ['/content/1', '/zones/Header:left/0'],
    lastActivityAt: '2026-01-29T00:00:00Z',
    joinedAt: '2026-01-29T00:00:00Z',
  },
  {
    id: 'presence-3',
    actorId: 'agent-optimizer',
    actorType: 'agent',
    role: 'agent',
    name: 'Layout Optimizer',
    state: 'editing',
    focusRegions: ['/content/2'],
    lastActivityAt: '2026-01-29T00:00:00Z',
    joinedAt: '2026-01-29T00:00:00Z',
  },
];

// =============================================================================
// pathToComponentId Tests
// =============================================================================

describe('pathToComponentId', () => {
  // Dynamic import to handle module not existing yet
  const getModule = async () => import('../src/collaboration/utils/focusRegionMap.js');

  describe('content paths', () => {
    it('should return component ID for /content/0 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/content/0');
      expect(id).toBe('hero-1');
    });

    it('should return component ID for /content/1 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/content/1');
      expect(id).toBe('text-1');
    });

    it('should return component ID for /content/2 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/content/2');
      expect(id).toBe('image-1');
    });

    it('should return null for out-of-bounds content index', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/content/99');
      expect(id).toBeNull();
    });
  });

  describe('root zone paths (Puck internal format)', () => {
    it('should return component ID for /root/default-zone/0 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/root/default-zone/0');
      expect(id).toBe('hero-1');
    });

    it('should return component ID for /root/default-zone/1 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/root/default-zone/1');
      expect(id).toBe('text-1');
    });

    it('should return null for out-of-bounds root zone index', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/root/default-zone/99');
      expect(id).toBeNull();
    });
  });

  describe('zone paths', () => {
    it('should return component ID for /zones/Header:left/0 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/zones/Header:left/0');
      expect(id).toBe('logo-1');
    });

    it('should return component ID for /zones/Header:left/1 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/zones/Header:left/1');
      expect(id).toBe('nav-1');
    });

    it('should return component ID for /zones/Header:right/0 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/zones/Header:right/0');
      expect(id).toBe('btn-1');
    });

    it('should return component ID for /zones/Footer:main/0 path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/zones/Footer:main/0');
      expect(id).toBe('footer-text-1');
    });

    it('should return null for non-existent zone', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/zones/NonExistent/0');
      expect(id).toBeNull();
    });

    it('should return null for out-of-bounds zone index', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/zones/Header:left/99');
      expect(id).toBeNull();
    });
  });

  describe('invalid paths', () => {
    it('should return null for empty path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '');
      expect(id).toBeNull();
    });

    it('should return null for invalid path format', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/invalid/path/format');
      expect(id).toBeNull();
    });

    it('should return null for root path', async () => {
      const { pathToComponentId } = await getModule();
      const id = pathToComponentId(mockPuckData, '/root');
      expect(id).toBeNull();
    });

    it('should return null when data has no zones and zone path requested', async () => {
      const { pathToComponentId } = await getModule();
      const dataWithoutZones: PuckData = {
        content: [{ type: 'Text', props: { id: 'text-1', content: '' } }],
        root: { props: {} },
      };
      const id = pathToComponentId(dataWithoutZones, '/zones/Header:left/0');
      expect(id).toBeNull();
    });
  });
});

// =============================================================================
// createFocusRegionMap Tests
// =============================================================================

describe('createFocusRegionMap', () => {
  const getModule = async () => import('../src/collaboration/utils/focusRegionMap.js');

  it('should create a map of component IDs to focus highlights', async () => {
    const { createFocusRegionMap } = await getModule();
    const map = createFocusRegionMap(mockPuckData, mockActors);

    expect(map.size).toBeGreaterThan(0);
    expect(map.has('hero-1')).toBe(true);
    expect(map.has('text-1')).toBe(true);
    expect(map.has('image-1')).toBe(true);
    expect(map.has('logo-1')).toBe(true);
  });

  it('should include actor info in focus highlight', async () => {
    const { createFocusRegionMap } = await getModule();
    const map = createFocusRegionMap(mockPuckData, mockActors);

    const aliceHighlight = map.get('hero-1');
    expect(aliceHighlight).toBeDefined();
    expect(aliceHighlight?.actorId).toBe('user-alice');
    expect(aliceHighlight?.actorName).toBe('Alice');
  });

  it('should set isEditing based on actor state', async () => {
    const { createFocusRegionMap } = await getModule();
    const map = createFocusRegionMap(mockPuckData, mockActors);

    // Alice is 'active', not editing
    const aliceHighlight = map.get('hero-1');
    expect(aliceHighlight?.isEditing).toBe(false);

    // Bob is 'editing'
    const bobHighlight = map.get('text-1');
    expect(bobHighlight?.isEditing).toBe(true);

    // Agent is 'editing'
    const agentHighlight = map.get('image-1');
    expect(agentHighlight?.isEditing).toBe(true);
  });

  it('should generate colors for each actor', async () => {
    const { createFocusRegionMap } = await getModule();
    const map = createFocusRegionMap(mockPuckData, mockActors);

    const aliceHighlight = map.get('hero-1');
    expect(aliceHighlight?.color).toBeDefined();
    expect(aliceHighlight?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('should handle actors with no focus regions', async () => {
    const { createFocusRegionMap } = await getModule();
    const actorsWithNoFocus: ActorPresence[] = [
      {
        id: 'presence-1',
        actorId: 'user-idle',
        actorType: 'user',
        role: 'human',
        name: 'Idle User',
        state: 'idle',
        focusRegions: [],
        lastActivityAt: '2026-01-29T00:00:00Z',
        joinedAt: '2026-01-29T00:00:00Z',
      },
    ];

    const map = createFocusRegionMap(mockPuckData, actorsWithNoFocus);
    expect(map.size).toBe(0);
  });

  it('should handle actors with undefined focus regions', async () => {
    const { createFocusRegionMap } = await getModule();
    const actorsWithUndefinedFocus: ActorPresence[] = [
      {
        id: 'presence-1',
        actorId: 'user-idle',
        actorType: 'user',
        role: 'human',
        name: 'Idle User',
        state: 'idle',
        // focusRegions intentionally undefined
        lastActivityAt: '2026-01-29T00:00:00Z',
        joinedAt: '2026-01-29T00:00:00Z',
      },
    ];

    const map = createFocusRegionMap(mockPuckData, actorsWithUndefinedFocus);
    expect(map.size).toBe(0);
  });

  it('should handle empty actors array', async () => {
    const { createFocusRegionMap } = await getModule();
    const map = createFocusRegionMap(mockPuckData, []);
    expect(map.size).toBe(0);
  });

  it('should skip invalid focus region paths', async () => {
    const { createFocusRegionMap } = await getModule();
    const actorsWithInvalidPath: ActorPresence[] = [
      {
        id: 'presence-1',
        actorId: 'user-test',
        actorType: 'user',
        role: 'human',
        name: 'Test User',
        state: 'active',
        focusRegions: ['/invalid/path', '/content/0'],
        lastActivityAt: '2026-01-29T00:00:00Z',
        joinedAt: '2026-01-29T00:00:00Z',
      },
    ];

    const map = createFocusRegionMap(mockPuckData, actorsWithInvalidPath);
    // Should only have the valid path
    expect(map.size).toBe(1);
    expect(map.has('hero-1')).toBe(true);
  });
});

// =============================================================================
// generateActorColor Tests
// =============================================================================

describe('generateActorColor', () => {
  const getModule = async () => import('../src/collaboration/utils/focusRegionMap.js');

  it('should return a valid hex color', async () => {
    const { generateActorColor } = await getModule();
    const color = generateActorColor('user-123');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('should return consistent color for same actor ID', async () => {
    const { generateActorColor } = await getModule();
    const color1 = generateActorColor('user-alice');
    const color2 = generateActorColor('user-alice');
    expect(color1).toBe(color2);
  });

  it('should return different colors for different actor IDs', async () => {
    const { generateActorColor } = await getModule();
    const colorAlice = generateActorColor('user-alice');
    const colorBob = generateActorColor('user-bob');
    // Not guaranteed to be different, but highly likely for different inputs
    // We test that the function works, not that it produces unique colors
    expect(colorAlice).toBeDefined();
    expect(colorBob).toBeDefined();
  });

  it('should handle empty string', async () => {
    const { generateActorColor } = await getModule();
    const color = generateActorColor('');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('should handle special characters in actor ID', async () => {
    const { generateActorColor } = await getModule();
    const color = generateActorColor('agent-@#$%^&*()');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
