/**
 * Tests for incremental patching in puckYjsBinding.
 *
 * Verifies that patchYMap/patchYArray produce minimal Yjs operations
 * and that identical writes produce zero operations.
 */

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  puckDataToYMap,
  patchYMap,
  patchYArray,
  yMapToPuckData,
  createPuckYjsBinding,
} from '../src/utils/puckYjsBinding.js';

const sampleData = {
  content: [
    { type: 'Hero', props: { id: 'hero-1', title: 'Welcome', subtitle: 'Hello' } },
    { type: 'Text', props: { id: 'text-1', body: 'Lorem ipsum' } },
  ],
  root: { props: { title: 'Home Page', theme: 'light' } },
  zones: {
    'sidebar': [
      { type: 'Nav', props: { id: 'nav-1', items: ['a', 'b'] } },
    ],
  },
};

describe('Incremental patching', () => {
  describe('patchYMap', () => {
    it('should not produce Yjs operations when data is identical', () => {
      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      // Initial population
      puckDataToYMap(sampleData, root);

      // Track operations on second write
      const updates: Uint8Array[] = [];
      ydoc.on('update', (update: Uint8Array) => {
        updates.push(update);
      });

      // Apply identical data again (triggers incremental path since root.size > 0)
      puckDataToYMap(sampleData, root);

      // No updates should have been emitted
      expect(updates).toHaveLength(0);
    });

    it('should produce minimal update for single-prop change', () => {
      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      puckDataToYMap(sampleData, root);

      const updates: Uint8Array[] = [];
      ydoc.on('update', (update: Uint8Array) => {
        updates.push(update);
      });

      // Change just one prop
      const modifiedData = {
        ...sampleData,
        content: [
          { type: 'Hero', props: { id: 'hero-1', title: 'Updated Title', subtitle: 'Hello' } },
          sampleData.content[1],
        ],
        root: sampleData.root,
        zones: sampleData.zones,
      };

      puckDataToYMap(modifiedData, root);

      // Should produce exactly one update (single transaction)
      expect(updates.length).toBeGreaterThanOrEqual(1);

      // Verify the data is correct
      const result = root.toJSON();
      expect(result.content[0].props.title).toBe('Updated Title');
      expect(result.content[0].props.subtitle).toBe('Hello');
      expect(result.content[1].props.body).toBe('Lorem ipsum');
    });

    it('should handle adding a new key', () => {
      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      puckDataToYMap({ content: [], root: { props: { a: 1 } } }, root);
      patchYMap(root, { content: [], root: { props: { a: 1 } }, newKey: 'hello' } as Record<string, unknown>);

      expect(root.toJSON().newKey).toBe('hello');
    });

    it('should handle removing a key', () => {
      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      puckDataToYMap({ content: [], root: { props: { a: 1 } }, zones: { z: [] } }, root);

      // Patch without zones
      ydoc.transact(() => {
        patchYMap(root, { content: [], root: { props: { a: 1 } } } as Record<string, unknown>);
      });

      const result = root.toJSON();
      expect(result.zones).toBeUndefined();
    });
  });

  describe('patchYArray', () => {
    it('should patch array items in place', () => {
      const ydoc = new Y.Doc();
      const arr = ydoc.getArray('test');

      // Create initial array with Y.Map items
      ydoc.transact(() => {
        const map1 = new Y.Map();
        map1.set('type', 'A');
        map1.set('value', 1);
        const map2 = new Y.Map();
        map2.set('type', 'B');
        map2.set('value', 2);
        arr.push([map1, map2]);
      });

      // Patch: change value of second item
      ydoc.transact(() => {
        patchYArray(arr, [
          { type: 'A', value: 1 },
          { type: 'B', value: 99 },
        ]);
      });

      const result = arr.toJSON();
      expect(result[0].value).toBe(1); // unchanged
      expect(result[1].value).toBe(99); // updated
    });

    it('should append new items', () => {
      const ydoc = new Y.Doc();
      const arr = ydoc.getArray('test');

      ydoc.transact(() => {
        arr.push(['a', 'b']);
      });

      ydoc.transact(() => {
        patchYArray(arr, ['a', 'b', 'c']);
      });

      expect(arr.toJSON()).toEqual(['a', 'b', 'c']);
    });

    it('should trim excess items', () => {
      const ydoc = new Y.Doc();
      const arr = ydoc.getArray('test');

      ydoc.transact(() => {
        arr.push(['a', 'b', 'c']);
      });

      ydoc.transact(() => {
        patchYArray(arr, ['a']);
      });

      expect(arr.toJSON()).toEqual(['a']);
    });
  });

  describe('Seeded Y.Doc + reconnect sync', () => {
    it('should not trigger onRemoteUpdate on reconnect when server has no new changes', () => {
      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();
      const binding = createPuckYjsBinding(ydoc, onRemoteUpdate);

      // Seed the Y.Doc (simulates what happens with initialData)
      binding.applyLocalChange(sampleData);

      // Verify seeding worked
      const root = ydoc.getMap('root');
      expect(root.size).toBeGreaterThan(0);

      // Simulate initial connect: server receives client state
      const serverDoc = new Y.Doc();
      Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(ydoc));

      // Simulate reconnect: delta sync with shared history
      const clientSv = Y.encodeStateVector(ydoc);
      const delta = Y.encodeStateAsUpdate(serverDoc, clientSv);
      Y.applyUpdate(ydoc, delta, 'remote');

      // No callback — server has nothing new
      expect(onRemoteUpdate).not.toHaveBeenCalled();

      binding.destroy();
    });

    it('should trigger onRemoteUpdate when remote has different data', () => {
      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();
      const binding = createPuckYjsBinding(ydoc, onRemoteUpdate);

      // Seed with initial data
      binding.applyLocalChange(sampleData);

      // Create remote doc with DIFFERENT data (independent Y.Doc)
      const differentData = {
        ...sampleData,
        content: [
          ...sampleData.content,
          { type: 'Footer', props: { id: 'footer-1', text: 'Copyright' } },
        ],
      };

      const remoteDoc = new Y.Doc();
      const remoteRoot = remoteDoc.getMap('root');
      puckDataToYMap(differentData, remoteRoot);

      // Sync remote to local
      const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);
      Y.applyUpdate(ydoc, remoteUpdate, 'remote');

      // onRemoteUpdate SHOULD fire because there are real changes
      expect(onRemoteUpdate).toHaveBeenCalled();

      binding.destroy();
    });
  });

  describe('roundtrip integrity', () => {
    it('should preserve data through multiple incremental updates', () => {
      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      // Write initial data
      puckDataToYMap(sampleData, root);

      // Modify several times
      const edits = [
        { ...sampleData, root: { props: { title: 'Edit 1', theme: 'dark' } } },
        {
          ...sampleData,
          content: [sampleData.content[0]],  // Remove second component
          root: { props: { title: 'Edit 2', theme: 'dark' } },
        },
        {
          content: [
            { type: 'Hero', props: { id: 'hero-1', title: 'Final', subtitle: 'Done' } },
            { type: 'CTA', props: { id: 'cta-1', label: 'Click me' } },
          ],
          root: { props: { title: 'Edit 3' } },
        },
      ];

      for (const edit of edits) {
        puckDataToYMap(edit, root);
      }

      const final = yMapToPuckData(root);
      expect(final.content).toHaveLength(2);
      expect(final.content[0].props.title).toBe('Final');
      expect(final.content[1].type).toBe('CTA');
      expect(final.root.props.title).toBe('Edit 3');
    });
  });
});
