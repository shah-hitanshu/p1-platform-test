/**
 * Phase 3.1: Puck-Yjs Binding Utility Tests (TDD)
 *
 * Tests for bidirectional sync between Puck data and Yjs CRDT.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

describe('Phase 3.1: Puck-Yjs Binding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('puckDataToYMap', () => {
    it('should convert PuckData to Yjs Y.Map structure', async () => {
      const { puckDataToYMap } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      const puckData = {
        content: [
          {
            type: 'Header',
            props: { title: 'Hello World', id: 'header-1' },
          },
        ],
        root: {
          props: { title: 'My Page' },
        },
      };

      puckDataToYMap(puckData, root);

      const result = root.toJSON();
      expect(result.content).toBeDefined();
      expect(result.root).toBeDefined();
    });

    it('should handle nested component structures', async () => {
      const { puckDataToYMap } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      const puckData = {
        content: [
          {
            type: 'Container',
            props: {
              id: 'container-1',
              children: [
                { type: 'Text', props: { id: 'text-1', content: 'Hello' } },
                { type: 'Text', props: { id: 'text-2', content: 'World' } },
              ],
            },
          },
        ],
        root: { props: {} },
      };

      puckDataToYMap(puckData, root);

      const result = root.toJSON();
      expect(result.content[0].type).toBe('Container');
      expect(result.content[0].props.children).toHaveLength(2);
    });

    it('should handle empty content array', async () => {
      const { puckDataToYMap } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      const puckData = {
        content: [],
        root: { props: {} },
      };

      puckDataToYMap(puckData, root);

      const result = root.toJSON();
      expect(result.content).toEqual([]);
    });
  });

  describe('yMapToPuckData', () => {
    it('should convert Yjs Y.Map to PuckData', async () => {
      const { yMapToPuckData, puckDataToYMap } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      const originalData = {
        content: [
          { type: 'Header', props: { id: 'header-1', title: 'Test' } },
        ],
        root: { props: { title: 'Page' } },
      };

      puckDataToYMap(originalData, root);
      const result = yMapToPuckData(root);

      expect(result.content).toBeDefined();
      expect(result.root).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('should preserve component types and props', async () => {
      const { yMapToPuckData, puckDataToYMap } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');

      const originalData = {
        content: [
          { type: 'Header', props: { id: 'h1', title: 'Hello', size: 'large' } },
          { type: 'Text', props: { id: 't1', content: 'World' } },
        ],
        root: { props: { backgroundColor: '#fff' } },
      };

      puckDataToYMap(originalData, root);
      const result = yMapToPuckData(root);

      expect(result.content[0].type).toBe('Header');
      expect(result.content[0].props.title).toBe('Hello');
      expect(result.content[1].type).toBe('Text');
      expect(result.root.props.backgroundColor).toBe('#fff');
    });
  });

  describe('createPuckYjsBinding', () => {
    it('should create a bidirectional binding', async () => {
      const { createPuckYjsBinding } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      const binding = createPuckYjsBinding(ydoc, onRemoteUpdate);

      expect(binding).toHaveProperty('applyLocalChange');
      expect(binding).toHaveProperty('destroy');
      expect(typeof binding.applyLocalChange).toBe('function');
      expect(typeof binding.destroy).toBe('function');
    });

    it('should apply local changes to Y.Doc', async () => {
      const { createPuckYjsBinding, yMapToPuckData } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      const binding = createPuckYjsBinding(ydoc, onRemoteUpdate);

      const newData = {
        content: [
          { type: 'Header', props: { id: 'h1', title: 'New Title' } },
        ],
        root: { props: {} },
      };

      binding.applyLocalChange(newData);

      const root = ydoc.getMap('root');
      const result = yMapToPuckData(root);

      expect(result.content[0].props.title).toBe('New Title');
    });

    it('should call onRemoteUpdate when remote changes arrive', async () => {
      const { createPuckYjsBinding } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      createPuckYjsBinding(ydoc, onRemoteUpdate);

      // Simulate a remote update
      const remoteDoc = new Y.Doc();
      const remoteRoot = remoteDoc.getMap('root');
      remoteDoc.transact(() => {
        const content = new Y.Array();
        content.push([{ type: 'Text', props: { id: 't1', content: 'Remote' } }]);
        remoteRoot.set('content', content);
        const rootData = new Y.Map();
        rootData.set('props', { title: 'Remote Page' });
        remoteRoot.set('root', rootData);
      }, 'remote');

      // Apply remote update to local doc
      const update = Y.encodeStateAsUpdate(remoteDoc);
      Y.applyUpdate(ydoc, update, 'remote');

      expect(onRemoteUpdate).toHaveBeenCalled();
    });

    it('should NOT trigger onRemoteUpdate for local changes', async () => {
      const { createPuckYjsBinding } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      const binding = createPuckYjsBinding(ydoc, onRemoteUpdate);

      // Apply a local change
      const newData = {
        content: [],
        root: { props: {} },
      };

      binding.applyLocalChange(newData);

      // onRemoteUpdate should NOT be called for local changes
      expect(onRemoteUpdate).not.toHaveBeenCalled();
    });

    it('should cleanup observers on destroy', async () => {
      const { createPuckYjsBinding } = await import('../src/editor/utils/puckYjsBinding.js');

      const ydoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      const binding = createPuckYjsBinding(ydoc, onRemoteUpdate);
      binding.destroy();

      // After destroy, remote updates should not trigger callback
      const remoteDoc = new Y.Doc();
      const remoteRoot = remoteDoc.getMap('root');
      remoteDoc.transact(() => {
        remoteRoot.set('content', new Y.Array());
      }, 'remote');

      const update = Y.encodeStateAsUpdate(remoteDoc);
      Y.applyUpdate(ydoc, update, 'remote');

      expect(onRemoteUpdate).not.toHaveBeenCalled();
    });
  });
});
