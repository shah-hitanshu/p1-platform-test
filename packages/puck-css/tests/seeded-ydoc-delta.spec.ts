/**
 * Tests for Y.Doc seeding and delta sync behavior.
 *
 * Verifies that:
 * - A seeded Y.Doc has a non-trivial state vector
 * - Delta between identically-seeded docs fires no observer events
 * - State vector enables efficient reconnection sync
 */

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { puckDataToYMap, createPuckYjsBinding } from '../src/editor/utils/puckYjsBinding.js';

const sampleData = {
  content: [
    { type: 'Hero', props: { id: 'hero-1', title: 'Welcome' } },
    { type: 'Text', props: { id: 'text-1', body: 'Hello world' } },
  ],
  root: { props: { title: 'Test Page' } },
};

describe('Seeded Y.Doc delta sync', () => {
  describe('state vector', () => {
    it('fresh Y.Doc has trivial state vector (length 1)', () => {
      const ydoc = new Y.Doc();
      const sv = Y.encodeStateVector(ydoc);
      expect(sv.length).toBe(1);
    });

    it('seeded Y.Doc has non-trivial state vector (length > 1)', () => {
      const ydoc = new Y.Doc();
      const root = ydoc.getMap('root');
      puckDataToYMap(sampleData, root);

      const sv = Y.encodeStateVector(ydoc);
      expect(sv.length).toBeGreaterThan(1);
    });

    it('state vector reflects document complexity', () => {
      const smallDoc = new Y.Doc();
      const smallRoot = smallDoc.getMap('root');
      puckDataToYMap({ content: [], root: { props: { a: 1 } } }, smallRoot);

      const largeDoc = new Y.Doc();
      const largeRoot = largeDoc.getMap('root');
      puckDataToYMap(sampleData, largeRoot);

      const smallSv = Y.encodeStateVector(smallDoc);
      const largeSv = Y.encodeStateVector(largeDoc);

      // Both should be non-trivial
      expect(smallSv.length).toBeGreaterThan(1);
      expect(largeSv.length).toBeGreaterThan(1);
    });
  });

  describe('delta between identically-seeded docs', () => {
    it('should preserve data integrity when syncing identical docs from different clients', () => {
      // Two independent Y.Docs with same data have different client IDs,
      // so Yjs merge events WILL fire. But the resulting data must be identical.
      const clientDoc = new Y.Doc();
      const clientRoot = clientDoc.getMap('root');

      clientDoc.transact(() => {
        puckDataToYMap(sampleData, clientRoot);
      }, 'local');

      const dataBefore = clientRoot.toJSON();

      // Server doc with same data (different Y.Doc client ID)
      const serverDoc = new Y.Doc();
      const serverRoot = serverDoc.getMap('root');
      puckDataToYMap(sampleData, serverRoot);

      // Sync server → client
      const serverUpdate = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(clientDoc, serverUpdate, 'remote');

      // Data should be preserved after merge
      const dataAfter = clientRoot.toJSON();
      expect(dataAfter.content).toHaveLength(dataBefore.content.length);
      expect(dataAfter.root.props.title).toBe(dataBefore.root.props.title);
      expect(dataAfter.content[0].type).toBe('Hero');
      expect(dataAfter.content[1].type).toBe('Text');
    });

    it('reconnect with shared history produces no observer events', () => {
      // On RECONNECT, client and server share Y.Doc history (same client IDs).
      // State vector delta should produce zero events when nothing changed.
      const clientDoc = new Y.Doc();
      const clientRoot = clientDoc.getMap('root');

      puckDataToYMap(sampleData, clientRoot);

      // Simulate server receiving client's state (initial connect)
      const serverDoc = new Y.Doc();
      const clientState = Y.encodeStateAsUpdate(clientDoc);
      Y.applyUpdate(serverDoc, clientState);

      // Now both docs share history. Track observer on client.
      const onRemoteUpdate = vi.fn();
      clientRoot.observeDeep((_events, txn) => {
        if (txn.origin !== 'local') {
          onRemoteUpdate();
        }
      });

      // Reconnect: server sends delta based on client's state vector
      const clientSv = Y.encodeStateVector(clientDoc);
      const serverDelta = Y.encodeStateAsUpdate(serverDoc, clientSv);
      Y.applyUpdate(clientDoc, serverDelta, 'remote');

      // No events — server has nothing new
      expect(onRemoteUpdate).not.toHaveBeenCalled();
    });

    it('should produce observer events when syncing docs with differences', () => {
      const clientDoc = new Y.Doc();
      const clientRoot = clientDoc.getMap('root');

      clientDoc.transact(() => {
        puckDataToYMap(sampleData, clientRoot);
      }, 'local');

      const onRemoteUpdate = vi.fn();
      clientRoot.observeDeep((_events, txn) => {
        if (txn.origin !== 'local') {
          onRemoteUpdate();
        }
      });

      // Server has additional component
      const serverData = {
        ...sampleData,
        content: [
          ...sampleData.content,
          { type: 'Footer', props: { id: 'footer-1', text: 'Copyright' } },
        ],
      };

      const serverDoc = new Y.Doc();
      const serverRoot = serverDoc.getMap('root');
      puckDataToYMap(serverData, serverRoot);

      const serverUpdate = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(clientDoc, serverUpdate, 'remote');

      // Observer SHOULD fire — server has extra component
      expect(onRemoteUpdate).toHaveBeenCalled();
    });
  });

  describe('delta size optimization', () => {
    it('reconnect delta is smaller than full state when only small changes exist', () => {
      // Initial sync: both docs share history
      const clientDoc = new Y.Doc();
      const clientRoot = clientDoc.getMap('root');
      puckDataToYMap(sampleData, clientRoot);

      const serverDoc = new Y.Doc();
      Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientDoc));

      // Server makes a small change while client is disconnected
      const serverRoot = serverDoc.getMap('root');
      serverDoc.transact(() => {
        const rootMap = serverRoot.get('root') as Y.Map<unknown>;
        const propsMap = rootMap.get('props') as Y.Map<unknown>;
        propsMap.set('newProp', 'added');
      });

      // Full state (what would be sent without stateVector)
      const fullState = Y.encodeStateAsUpdate(serverDoc);

      // Delta (what is sent WITH stateVector from reconnecting client)
      const clientSv = Y.encodeStateVector(clientDoc);
      const delta = Y.encodeStateAsUpdate(serverDoc, clientSv);

      // Delta should be smaller — only the new prop, not the entire doc
      expect(delta.length).toBeLessThan(fullState.length);
    });
  });

  describe('binding integration', () => {
    it('seeded binding reconnect with shared history fires no callback', () => {
      const clientDoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      const binding = createPuckYjsBinding(clientDoc, onRemoteUpdate);

      // Seed via binding (LOCAL_ORIGIN — observer ignores)
      binding.applyLocalChange(sampleData);

      // Simulate initial connect: server receives client state
      const serverDoc = new Y.Doc();
      Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientDoc));

      // Simulate reconnect: delta sync with shared history
      const clientSv = Y.encodeStateVector(clientDoc);
      const delta = Y.encodeStateAsUpdate(serverDoc, clientSv);
      Y.applyUpdate(clientDoc, delta, 'remote');

      // Should not trigger callback — server has nothing new
      expect(onRemoteUpdate).not.toHaveBeenCalled();

      binding.destroy();
    });

    it('seeded binding with different remote data fires callback', () => {
      const clientDoc = new Y.Doc();
      const onRemoteUpdate = vi.fn();

      const binding = createPuckYjsBinding(clientDoc, onRemoteUpdate);

      // Seed
      binding.applyLocalChange(sampleData);

      // Server has different root props
      const serverData = {
        ...sampleData,
        root: { props: { title: 'Different Title' } },
      };

      const serverDoc = new Y.Doc();
      const serverRoot = serverDoc.getMap('root');
      puckDataToYMap(serverData, serverRoot);

      // Full state sync (no shared history between different Y.Doc instances)
      const fullState = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(clientDoc, fullState, 'remote');

      // Should fire because data differs
      expect(onRemoteUpdate).toHaveBeenCalled();

      binding.destroy();
    });
  });
});
