import type { Data } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';

import {
  applySemanticOps,
  computeSemanticOps,
} from '../../data/semantic-ops';

function makeData(overrides: Partial<Data> = {}): Data {
  return {
    content: [],
    root: { props: {} },
    zones: {},
    ...overrides,
  } as Data;
}

describe('applySemanticOps', () => {
  it('sets root prop', () => {
    const base = makeData();
    const result = applySemanticOps(base, [
      { op: 'setRootProp', propPath: 'title', value: 'Hello' },
    ]);
    expect((result.root as { props: Record<string, unknown> }).props.title).toBe('Hello');
  });

  it('removes root prop', () => {
    const base = makeData({ root: { props: { title: 'X' } } });
    const result = applySemanticOps(base, [
      { op: 'removeRootProp', propPath: 'title' },
    ]);
    expect((result.root as { props: Record<string, unknown> }).props.title).toBeUndefined();
  });

  it('sets block prop', () => {
    const base = makeData({
      content: [{ type: 'Text', props: { id: 'b1', text: 'old' } }] as Data['content'],
    });
    const result = applySemanticOps(base, [
      { op: 'setProp', blockId: 'b1', propPath: 'text', value: 'new' },
    ]);
    const block = (result.content as { props: Record<string, unknown> }[])[0];
    expect(block.props.text).toBe('new');
  });

  it('removes block prop', () => {
    const base = makeData({
      content: [{ type: 'Text', props: { id: 'b1', text: 'old', extra: true } }] as Data['content'],
    });
    const result = applySemanticOps(base, [
      { op: 'removeProp', blockId: 'b1', propPath: 'extra' },
    ]);
    const block = (result.content as { props: Record<string, unknown> }[])[0];
    expect(block.props.extra).toBeUndefined();
  });

  it('adds a block', () => {
    const base = makeData();
    const result = applySemanticOps(base, [
      { op: 'addBlock', block: { type: 'Text', props: { id: 'new1', text: 'hi' } }, slot: 'content', afterId: null },
    ]);
    expect((result.content as unknown[]).length).toBe(1);
  });

  it('removes a block', () => {
    const base = makeData({
      content: [{ type: 'Text', props: { id: 'b1' } }] as Data['content'],
    });
    const result = applySemanticOps(base, [
      { op: 'removeBlock', blockId: 'b1' },
    ]);
    expect((result.content as unknown[]).length).toBe(0);
  });

  it('moves a block within content', () => {
    const base = makeData({
      content: [
        { type: 'A', props: { id: 'a1' } },
        { type: 'B', props: { id: 'b1' } },
        { type: 'C', props: { id: 'c1' } },
      ] as Data['content'],
    });
    const result = applySemanticOps(base, [
      { op: 'moveBlock', blockId: 'c1', slot: 'content', afterId: null },
    ]);
    const ids = (result.content as { props: { id: string } }[]).map((b) => b.props.id);
    expect(ids[0]).toBe('c1');
  });

  it('does not mutate the original data', () => {
    const base = makeData({ root: { props: { title: 'original' } } });
    applySemanticOps(base, [
      { op: 'setRootProp', propPath: 'title', value: 'changed' },
    ]);
    expect((base.root as { props: Record<string, unknown> }).props.title).toBe('original');
  });

  it('rejects prototype pollution via __proto__', () => {
    const base = makeData();
    const result = applySemanticOps(base, [
      { op: 'setRootProp', propPath: '__proto__', value: 'hacked' },
    ]);
    expect((result as Record<string, unknown>).__proto__).not.toBe('hacked');
  });
});

describe('computeSemanticOps', () => {
  it('detects root prop changes', () => {
    const canonical = makeData({ root: { props: { title: 'A' } } });
    const edited = makeData({ root: { props: { title: 'B' } } });
    const ops = computeSemanticOps(canonical, edited);
    expect(ops).toContainEqual({
      op: 'setRootProp',
      propPath: 'title',
      value: 'B',
    });
  });

  it('detects block removals', () => {
    const canonical = makeData({
      content: [{ type: 'Text', props: { id: 'b1' } }] as Data['content'],
    });
    const edited = makeData();
    const ops = computeSemanticOps(canonical, edited);
    expect(ops).toContainEqual({ op: 'removeBlock', blockId: 'b1' });
  });

  it('detects block additions', () => {
    const canonical = makeData();
    const edited = makeData({
      content: [{ type: 'Text', props: { id: 'b1', text: 'hi' } }] as Data['content'],
    });
    const ops = computeSemanticOps(canonical, edited);
    const addOps = ops.filter((o) => o.op === 'addBlock');
    expect(addOps.length).toBe(1);
  });

  it('round-trips: apply(canonical, compute(canonical, edited)) ≈ edited', () => {
    const canonical = makeData({
      root: { props: { title: 'Home' } },
      content: [
        { type: 'Text', props: { id: 't1', text: 'hello' } },
        { type: 'Image', props: { id: 'i1', src: '/a.png' } },
      ] as Data['content'],
    });
    const edited = makeData({
      root: { props: { title: 'Updated Home' } },
      content: [
        { type: 'Image', props: { id: 'i1', src: '/b.png' } },
        { type: 'Text', props: { id: 't1', text: 'hello' } },
        { type: 'Button', props: { id: 'btn1', label: 'Click' } },
      ] as Data['content'],
    });
    const ops = computeSemanticOps(canonical, edited);
    const result = applySemanticOps(canonical, ops);
    expect((result.root as { props: Record<string, unknown> }).props.title).toBe('Updated Home');
    const resultIds = (result.content as { props: { id: string } }[]).map((b) => b.props.id);
    expect(resultIds).toContain('btn1');
  });
});
