// @vitest-environment node
/**
 * The editor reports JSON pointers (`/content/0`) and agent sessions reserve dot
 * notation (`content.0`); a path deeper than a component resolves to it.
 */

import { describe, it, expect } from 'vitest';
import type { PuckData, ActorPresence } from '@pantheon-systems/css-client';
import {
  pathToComponentId,
  createFocusRegionMap,
} from '../src/collaboration/utils/focusRegionMap.js';

const data: PuckData = {
  content: [
    { type: 'Hero', props: { id: 'hero-1', title: 'Welcome', meta: { title: 'SEO' } } },
    { type: 'Text', props: { id: 'text-1', content: 'Hello' } },
    {
      type: 'Columns',
      props: {
        id: 'columns-1',
        columns: [
          { type: 'Text', props: { id: 'col-text-1', content: 'Left' } },
          { type: 'Image', props: { id: 'col-image-1', src: '/right.png' } },
        ],
      },
    },
  ],
  root: { props: { title: 'Page' } },
  zones: {
    'Header:left': [
      { type: 'Logo', props: { id: 'logo-1' } },
      { type: 'Nav', props: { id: 'nav-1' } },
    ],
  },
};

describe('pathToComponentId, dot-notation', () => {
  it('resolves a component path', () => {
    expect(pathToComponentId(data, 'content.0')).toBe('hero-1');
    expect(pathToComponentId(data, 'content.1')).toBe('text-1');
  });

  it('resolves a prop path to the component owning the prop', () => {
    expect(pathToComponentId(data, 'content.0.props.title')).toBe('hero-1');
  });

  it('resolves the root zone alias', () => {
    expect(pathToComponentId(data, 'root.default-zone.0')).toBe('hero-1');
  });

  it('resolves a zone path', () => {
    expect(pathToComponentId(data, 'zones.Header:left.1')).toBe('nav-1');
  });

  it('returns null for an out-of-range index', () => {
    expect(pathToComponentId(data, 'content.9')).toBeNull();
  });
});

describe('pathToComponentId, depth', () => {
  it('resolves a slot path to the nested child, not its parent', () => {
    expect(pathToComponentId(data, 'content.2.props.columns.1')).toBe('col-image-1');
    expect(pathToComponentId(data, '/content/2/props/columns/1')).toBe('col-image-1');
  });

  it('keeps the deepest component when the path continues past it', () => {
    expect(pathToComponentId(data, 'content.2.props.columns.0.props.content')).toBe('col-text-1');
  });

  it('resolves the parent when the path stops above the slot', () => {
    expect(pathToComponentId(data, 'content.2.props.columns')).toBe('columns-1');
  });

  it('keeps the component when the path runs into a prop that does not exist', () => {
    expect(pathToComponentId(data, 'content.0.props.nope.deeper')).toBe('hero-1');
  });

  it('returns null for a path naming no component', () => {
    expect(pathToComponentId(data, 'content')).toBeNull();
    expect(pathToComponentId(data, 'zones')).toBeNull();
  });

  it('returns null for an array index that is not a number', () => {
    expect(pathToComponentId(data, 'content.length')).toBeNull();
  });
});

describe('pathToComponentId, mixed notation', () => {
  it('does not split a pointer segment on its dot', () => {
    expect(pathToComponentId(data, '/content/0/props/meta.title')).toBe('hero-1');
  });

  it('accepts a dot-notation path with a leading slash', () => {
    expect(pathToComponentId(data, '/content.0')).toBe('hero-1');
  });

  // Only pointer form can address a zone name holding a dot.
  it('handles a zone name containing a dot, in pointer form', () => {
    const dotted: PuckData = {
      ...data,
      zones: { 'Head.er:left': [{ type: 'Logo', props: { id: 'dotted-logo' } }] },
    };

    expect(pathToComponentId(dotted, '/zones/Head.er:left/0')).toBe('dotted-logo');
  });
});

describe('createFocusRegionMap, agent reservations', () => {
  const agent = (focusRegions: string[]): ActorPresence => ({
    id: 'presence-agent',
    actorId: 'agent-1',
    actorType: 'agent',
    role: 'agent',
    name: 'Zappy AI Assistant',
    state: 'editing',
    intent: 'Rewriting the hero',
    focusRegions,
    lastActivityAt: '2026-09-11T00:00:00Z',
    joinedAt: '2026-09-11T00:00:00Z',
  });

  it('highlights the block an agent reserved in dot-notation', () => {
    const map = createFocusRegionMap(data, [agent(['content.0'])]);

    expect(map.get('hero-1')).toMatchObject({ actorId: 'agent-1', isEditing: true });
  });

  it('highlights the block behind a prop-level reservation', () => {
    const map = createFocusRegionMap(data, [agent(['content.1.props.content'])]);

    expect(map.has('text-1')).toBe(true);
  });

  it('highlights every reserved block at once', () => {
    const map = createFocusRegionMap(data, [agent(['content.0', 'content.2.props.columns.1'])]);

    expect([...map.keys()]).toEqual(['hero-1', 'col-image-1']);
  });
});
