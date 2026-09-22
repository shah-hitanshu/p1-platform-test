/**
 * The agent overlay's mount points: one per run of blocks an agent holds, laid
 * over them in the page, with a marker in the editor's gutter for the top run.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  syncAgentHosts,
  hasUndrawnAgentBlocks,
  positionAgentHosts,
  agentBlockIdAt,
  markSelectedAgentHost,
  agentRunBlocks,
  AGENT_FADE_MS,
  agentHostLayer,
  placeAgentHosts,
  syncAgentGutterMarkers,
  unzoomAgentLayer,
  observeAgentPageLayout,
  agentLayoutTargets,
} from '../src/collaboration/utils/agentBlockHosts.js';
import type { FocusHighlight } from '../src/collaboration/utils/focusRegionMap.js';

function agent(overrides: Partial<FocusHighlight> = {}): FocusHighlight {
  return {
    actorId: 'agent-1',
    actorName: 'Pantheon Agent',
    color: '#000000',
    isEditing: true,
    isAgent: true,
    ...overrides,
  };
}

function person(): FocusHighlight {
  return {
    actorId: 'user-alice',
    actorName: 'Alice',
    color: '#123456',
    isEditing: false,
    isAgent: false,
  };
}

function blockFor(componentId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-puck-component="${componentId}"]`);
  if (!el) throw new Error(`no block rendered for ${componentId}`);
  return el;
}

function mount(): HTMLElement {
  const el = document.getElementById('canvas-inner');
  if (!el) throw new Error('no mount rendered');
  return el;
}

function mountPoints(): NodeListOf<HTMLElement> {
  return mount().querySelectorAll<HTMLElement>('.focus-region-agent-host');
}

/** jsdom lays nothing out, so an element only has a box if it is given one. */
function box(el: Element, top: number, left: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ top, left, width, height, right: left + width, bottom: top + height }) as DOMRect;
}

function placeBlock(componentId: string, top: number, left: number): void {
  box(blockFor(componentId), top, left, 600, 200);
}

/** The width the frame would have unzoomed; the editor zooms by scaling it. */
function frameLayoutWidth(width: number, height = 0): void {
  const frame = document.getElementById('preview-frame');
  if (!frame) throw new Error('no frame rendered');
  Object.defineProperty(frame, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(frame, 'clientHeight', { value: height, configurable: true });
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="canvas">
      <div id="canvas-inner">
        <div id="puck-canvas-root"><iframe id="preview-frame"></iframe></div>
      </div>
    </div>
    <div data-puck-component="hero-1"></div>
    <div data-puck-component="text-1"></div>
  `;
  // The 24px gutter PuckEditorTheme.css holds open above the page.
  box(document.getElementById('canvas')!, 108, 0, 800, 600);
  box(mount(), 132, 0, 800, 568);
  box(document.getElementById('preview-frame')!, 132, 0, 800, 568);
});

describe('syncAgentHosts', () => {
  it('lays a mount point over the block the agent holds', () => {
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    expect(hosts.get('hero-1')?.parentElement).toBe(mount());
    expect(hosts.get('hero-1')?.getAttribute('data-agent-block')).toBe('hero-1');
    expect(hosts.get('hero-1')?.className).toBe('focus-region-agent-host');
  });

  it('gives the mount point the colour the block is marked in', () => {
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    expect(hosts.get('hero-1')?.style.getPropertyValue('--focus-color')).toBe('#000000');
  });

  it('leaves a person’s block alone', () => {
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', person()]]), new Map());

    expect(hosts.size).toBe(0);
    expect(mountPoints()).toHaveLength(0);
  });

  it('keeps the same mount point while the agent holds the block', () => {
    const focusMap = new Map([['hero-1', agent()]]);
    const first = syncAgentHosts(document, mount(), focusMap, new Map());
    const second = syncAgentHosts(document, mount(), focusMap, first);

    // Same map back, so the editor re-renders nothing.
    expect(second).toBe(first);
    expect(mountPoints()).toHaveLength(1);
  });

  // React may run a state updater twice.
  it('adds one mount point even when called twice from the same starting point', () => {
    const focusMap = new Map([['hero-1', agent()]]);
    const first = syncAgentHosts(document, mount(), focusMap, new Map());
    const again = syncAgentHosts(document, mount(), focusMap, new Map());

    expect(mountPoints()).toHaveLength(1);
    expect(again.get('hero-1')).toBe(first.get('hero-1'));
  });

  it('starts the mount point fading when the agent lets go', () => {
    vi.useFakeTimers();
    const held = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    const leaving = syncAgentHosts(document, mount(), new Map(), held);

    expect(leaving.get('hero-1')?.hasAttribute('data-leaving')).toBe(true);
    expect(mountPoints()).toHaveLength(1);
    vi.useRealTimers();
  });

  it('takes the mount point away once the fade has run', () => {
    vi.useFakeTimers();
    const held = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());
    syncAgentHosts(document, mount(), new Map(), held);

    vi.advanceTimersByTime(AGENT_FADE_MS);

    expect(mountPoints()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('keeps the mount point when the agent takes the block back mid-fade', () => {
    vi.useFakeTimers();
    const focusMap = new Map([['hero-1', agent()]]);
    const held = syncAgentHosts(document, mount(), focusMap, new Map());
    const leaving = syncAgentHosts(document, mount(), new Map(), held);

    const retaken = syncAgentHosts(document, mount(), focusMap, leaving);
    vi.advanceTimersByTime(AGENT_FADE_MS * 2);

    expect(retaken.get('hero-1')?.hasAttribute('data-leaving')).toBe(false);
    expect(mountPoints()).toHaveLength(1);
    vi.useRealTimers();
  });

  // Hosts live beside the blocks, so nothing removes them along with one.
  it('takes the mount point away when the canvas drops the block', () => {
    const focusMap = new Map([['hero-1', agent()]]);
    const first = syncAgentHosts(document, mount(), focusMap, new Map());
    blockFor('hero-1').remove();

    const second = syncAgentHosts(document, mount(), focusMap, first);

    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
    expect(mountPoints()).toHaveLength(0);
  });

  it('holds one mount point per block', () => {
    const hosts = syncAgentHosts(
      document,
      mount(),
      new Map([
        ['hero-1', agent()],
        ['text-1', agent({ actorId: 'agent-2' })],
      ]),
      new Map(),
    );

    expect([...hosts.keys()]).toEqual(['hero-1', 'text-1']);
  });

  it('skips a block the canvas has not drawn', () => {
    const hosts = syncAgentHosts(
      document,
      mount(),
      new Map([['never-rendered', agent()]]),
      new Map(),
    );

    expect(hosts.size).toBe(0);
  });
});

describe('positionAgentHosts', () => {
  it('puts the mount point where the block is', () => {
    placeBlock('hero-1', 120, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    const host = hosts.get('hero-1');
    expect(host?.style.top).toBe('120px');
    expect(host?.style.left).toBe('40px');
    expect(host?.style.width).toBe('600px');
    expect(host?.style.height).toBe('200px');
  });

  it('does not count the page’s scroll twice', () => {
    placeBlock('hero-1', 120, 40);
    document.documentElement.scrollTop = 300;
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.style.top).toBe('120px');
    document.documentElement.scrollTop = 0;
  });

  it('shifts by where the frame sits in the editor', () => {
    box(document.getElementById('preview-frame')!, 172, 24, 800, 568);
    placeBlock('hero-1', 120, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.style.top).toBe('160px');
    expect(hosts.get('hero-1')?.style.left).toBe('64px');
  });

  it('scales the block’s box by the editor’s zoom', () => {
    frameLayoutWidth(1600);
    placeBlock('hero-1', 120, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    const host = hosts.get('hero-1');
    expect(host?.style.top).toBe('60px');
    expect(host?.style.width).toBe('300px');
    expect(host?.style.height).toBe('100px');
  });

  it('hides a block scrolled out of the frame', () => {
    frameLayoutWidth(800, 568);
    placeBlock('hero-1', -400, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.style.display).toBe('none');
  });

  it('leaves the marker room to hang while the whole block is in view', () => {
    placeBlock('hero-1', 120, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    // Negative: the cut sits above the block's edge, where the marker hangs.
    expect(hosts.get('hero-1')?.style.getPropertyValue('--agent-clip-top')).toBe('-20px');
  });

  it('cuts the overlay back to the page’s top edge as the block scrolls past it', () => {
    placeBlock('hero-1', -46, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.style.getPropertyValue('--agent-clip-top')).toBe('46px');
  });

  it('cuts the overlay back to the page’s bottom edge as well', () => {
    frameLayoutWidth(800, 568);
    placeBlock('hero-1', 500, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    // 500 + 200 of block against a 568 viewport.
    expect(hosts.get('hero-1')?.style.getPropertyValue('--agent-clip-bottom')).toBe('132px');
  });

  // clientHeight is unzoomed, while the marker is placed in editor pixels.
  it('scales the cut by the editor’s zoom', () => {
    frameLayoutWidth(1600, 1136);
    placeBlock('hero-1', 1000, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    // 64px past a 1136 viewport, at half size.
    expect(hosts.get('hero-1')?.style.getPropertyValue('--agent-clip-bottom')).toBe('32px');
  });

  // The 40px badge is centred on the edge, so 20px of it hangs past.
  it('still lets the marker straddle the first block at the badge’s full size', () => {
    // 20px of room: less than the gutter, exactly the overhang.
    box(document.getElementById('canvas')!, 112, 0, 800, 600);
    placeBlock('hero-1', 0, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.hasAttribute('data-at-page-top')).toBe(false);
  });

  it('drops the marker inside the block when there is less room than the badge needs', () => {
    // 19px of room: one pixel short.
    box(document.getElementById('canvas')!, 113, 0, 800, 600);
    placeBlock('hero-1', 0, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.hasAttribute('data-at-page-top')).toBe(true);
  });

  // The edge the marker sits on is the gutter's business alone. The pair above
  // varies the gutter with the block at rest; this varies the block instead.
  it('does not move the marker to the other edge just because the block scrolled', () => {
    placeBlock('hero-1', -46, 40);
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1')?.hasAttribute('data-at-page-top')).toBe(false);
  });
});

describe('a run of neighbouring blocks', () => {
  function heldRun(): Map<string, FocusHighlight> {
    return new Map([
      ['hero-1', agent()],
      ['text-1', agent()],
    ]);
  }

  it('lays one mount point over the whole run', () => {
    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    expect(mountPoints()).toHaveLength(1);
    expect([...hosts.keys()]).toEqual(['hero-1 text-1']);
  });

  it('names the blocks the mount point covers', () => {
    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    expect(agentRunBlocks([...hosts.keys()][0])).toEqual(['hero-1', 'text-1']);
  });

  it('breaks the run at a block the agent has not taken', () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-puck-component="cta-1"></div>');

    const hosts = syncAgentHosts(
      document,
      mount(),
      new Map([
        ['hero-1', agent()],
        ['cta-1', agent()],
      ]),
      new Map(),
    );

    expect([...hosts.keys()]).toEqual(['hero-1', 'cta-1']);
  });

  // Otherwise the box would be nested inside itself.
  it('does not join a block to the one it sits inside', () => {
    blockFor('text-1').innerHTML = '<div data-puck-component="child-1"></div>';

    const hosts = syncAgentHosts(
      document,
      mount(),
      new Map([
        ['text-1', agent()],
        ['child-1', agent()],
      ]),
      new Map(),
    );

    expect([...hosts.keys()]).toEqual(['text-1', 'child-1']);
  });

  // The walk descends into a container, so a cursor that followed the walk
  // would put its children between two blocks that are in fact adjacent.
  // ColumnsBlock ships four slots, so a filled container is the ordinary case.
  it('joins two blocks either side of a container the agent also holds', () => {
    blockFor('hero-1').innerHTML = '<div data-puck-component="child-1"></div>';

    const hosts = syncAgentHosts(
      document,
      mount(),
      new Map([
        ['hero-1', agent()],
        ['child-1', agent()],
        ['text-1', agent()],
      ]),
      new Map(),
    );

    expect([...hosts.keys()]).toEqual(['hero-1 text-1', 'child-1']);
  });

  it('joins them across a child the agent does not hold', () => {
    blockFor('hero-1').innerHTML = '<div data-puck-component="child-1"></div>';

    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    expect([...hosts.keys()]).toEqual(['hero-1 text-1']);
  });

  it('reaches from the first block’s top to the last block’s bottom', () => {
    placeBlock('hero-1', 100, 40);
    box(blockFor('text-1'), 300, 40, 600, 150);
    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    positionAgentHosts(document, mount(), hosts);

    const host = hosts.get('hero-1 text-1');
    expect(host?.style.top).toBe('100px');
    expect(host?.style.height).toBe('350px');
  });

  it('cuts the run back to the page’s bottom edge by its last block', () => {
    frameLayoutWidth(800, 568);
    placeBlock('hero-1', 300, 40);
    box(blockFor('text-1'), 500, 40, 600, 200);
    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    positionAgentHosts(document, mount(), hosts);

    // 700 of run against a 568 viewport.
    expect(
      hosts.get('hero-1 text-1')?.style.getPropertyValue('--agent-clip-bottom'),
    ).toBe('132px');
  });

  it('stays on screen while the run’s last block is still in view', () => {
    frameLayoutWidth(800, 568);
    placeBlock('hero-1', -400, 40);
    box(blockFor('text-1'), -200, 40, 600, 300);
    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    positionAgentHosts(document, mount(), hosts);

    expect(hosts.get('hero-1 text-1')?.style.display).toBe('');
  });

  it('marks the whole run when the reader picks out any block in it', () => {
    const hosts = syncAgentHosts(document, mount(), heldRun(), new Map());

    markSelectedAgentHost(hosts, 'text-1');

    expect(hosts.get('hero-1 text-1')?.hasAttribute('data-selected')).toBe(true);
  });
});

describe('hasUndrawnAgentBlocks', () => {
  it('reports a block that is held but not on screen', () => {
    expect(hasUndrawnAgentBlocks(document, new Map([['never-rendered', agent()]]))).toBe(true);
  });

  it('is quiet once every held block is on screen', () => {
    expect(hasUndrawnAgentBlocks(document, new Map([['hero-1', agent()]]))).toBe(false);
  });

  it('ignores a person waiting on a block that is not drawn', () => {
    expect(hasUndrawnAgentBlocks(document, new Map([['never-rendered', person()]]))).toBe(false);
  });
});

describe('marking the block the reader picked out', () => {
  it('finds the block a pointer landed in', () => {
    const inner = document.createElement('span');
    blockFor('hero-1').appendChild(inner);

    expect(agentBlockIdAt(inner)).toBe('hero-1');
  });

  it('finds nothing when the pointer landed outside every block', () => {
    expect(agentBlockIdAt(document.getElementById('canvas'))).toBe(null);
    expect(agentBlockIdAt(null)).toBe(null);
  });

  // jsdom cannot give us a second realm, so this covers the target's shape and
  // asElement's duck typing covers the realm.
  it('reads a target from another document', () => {
    const foreign = document.implementation.createHTMLDocument();
    foreign.body.innerHTML = '<div data-puck-component="hero-1"><b>x</b></div>';

    expect(agentBlockIdAt(foreign.querySelector('b'))).toBe('hero-1');
  });

  it('is quiet about a target that is not an element at all', () => {
    expect(agentBlockIdAt(document)).toBe(null);
    expect(agentBlockIdAt({} as EventTarget)).toBe(null);
  });

  it('marks the one block picked out and clears the rest', () => {
    const hosts = syncAgentHosts(
      document,
      mount(),
      new Map([
        ['hero-1', agent()],
        ['text-1', agent({ actorId: 'agent-2' })],
      ]),
      new Map(),
    );

    markSelectedAgentHost(hosts, 'text-1');

    expect(hosts.get('hero-1')?.hasAttribute('data-selected')).toBe(false);
    expect(hosts.get('text-1')?.hasAttribute('data-selected')).toBe(true);
  });

  it('clears the marking when nothing is picked out', () => {
    const hosts = syncAgentHosts(document, mount(), new Map([['hero-1', agent()]]), new Map());
    markSelectedAgentHost(hosts, 'hero-1');

    markSelectedAgentHost(hosts, null);

    expect(hosts.get('hero-1')?.hasAttribute('data-selected')).toBe(false);
  });
});

// jsdom has one document, standing in for both the page and the editor.
describe('the overlay inside the page', () => {
  function layer(): HTMLElement {
    const el = agentHostLayer(document);
    if (!el) throw new Error('no layer added');
    return el;
  }

  /** Scrolls the page by moving what the page measures its boxes against. */
  function scrollPage(by: number): void {
    box(document.documentElement, -by, 0, 800, 2000);
    box(layer(), -by, 0, 0, 0);
  }

  beforeEach(() => {
    scrollPage(0);
  });

  it('hangs the overlays from a layer of their own in the page', () => {
    expect(layer().parentElement).toBe(document.body);
    expect(layer().className).toBe('focus-region-agent-layer');
  });

  it('adds the layer once however often it is asked for', () => {
    expect(agentHostLayer(document)).toBe(agentHostLayer(document));
    expect(document.querySelectorAll('.focus-region-agent-layer')).toHaveLength(1);
  });

  // Named here so a rename cannot quietly break the end-to-end suite.
  it('gives each overlay the handle an end-to-end test targets', () => {
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(hosts.get('hero-1')?.getAttribute('data-testid')).toBe('agent-block-overlay');
  });

  // The editor copies the stylesheet into the page late.
  it('pins the layer to the page’s origin itself, without waiting on the stylesheet', () => {
    expect(layer().style.position).toBe('absolute');
    expect(layer().style.top).toBe('0px');
    expect(layer().style.left).toBe('0px');
  });

  // The editor replaces the canvas's document at startup; the old one stays connected.
  it('moves the overlays into a page that has replaced the one they were in', () => {
    const focusMap = new Map([['hero-1', agent()]]);
    const stale = syncAgentHosts(document, layer(), focusMap, new Map());
    const next = document.implementation.createHTMLDocument();
    next.body.innerHTML = '<div data-puck-component="hero-1"></div>';
    const nextLayer = agentHostLayer(next);
    if (!nextLayer) throw new Error('no layer added');

    const hosts = syncAgentHosts(next, nextLayer, focusMap, stale);

    expect(hosts.get('hero-1')?.parentElement).toBe(nextLayer);
    expect(layer().children).toHaveLength(0);
  });

  it('puts the overlay where the block is on the page', () => {
    placeBlock('hero-1', 120, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    placeAgentHosts(document, layer(), hosts);

    const host = hosts.get('hero-1');
    expect(host?.parentElement).toBe(layer());
    expect(host?.style.top).toBe('120px');
    expect(host?.style.left).toBe('40px');
    expect(host?.style.width).toBe('600px');
    expect(host?.style.height).toBe('200px');
  });

  it('places the overlay by the page, not by where the page is scrolled to', () => {
    scrollPage(300);
    placeBlock('hero-1', -180, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    placeAgentHosts(document, layer(), hosts);

    expect(hosts.get('hero-1')?.style.top).toBe('120px');
  });

  it('leaves the editor’s zoom to the page', () => {
    frameLayoutWidth(1600);
    placeBlock('hero-1', 120, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    placeAgentHosts(document, layer(), hosts);

    expect(hosts.get('hero-1')?.style.top).toBe('120px');
    expect(hosts.get('hero-1')?.style.width).toBe('600px');
  });

  it('reaches from the first block’s top to the last block’s bottom of a run', () => {
    placeBlock('hero-1', 100, 40);
    box(blockFor('text-1'), 300, 40, 600, 150);
    const run = new Map([
      ['hero-1', agent()],
      ['text-1', agent()],
    ]);
    const hosts = syncAgentHosts(document, layer(), run, new Map());

    placeAgentHosts(document, layer(), hosts);

    expect(hosts.get('hero-1 text-1')?.style.top).toBe('100px');
    expect(hosts.get('hero-1 text-1')?.style.height).toBe('350px');
  });

  // Nothing re-places it on scroll, so it must still be drawn when scrolled back.
  it('does not hide an overlay whose block is out of view', () => {
    frameLayoutWidth(800, 568);
    placeBlock('hero-1', -400, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    placeAgentHosts(document, layer(), hosts);

    expect(hosts.get('hero-1')?.style.display).toBe('');
  });

  // A cut written once would stay put as the block scrolled away.
  it('writes no cut onto an overlay in the page', () => {
    frameLayoutWidth(800, 568);
    placeBlock('hero-1', -46, 40);

    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(hosts.get('hero-1')?.style.getPropertyValue('--agent-clip-top')).toBe('');
    expect(hosts.get('hero-1')?.style.display).toBe('');
  });

  it('reports a run that starts at the top of the page', () => {
    placeBlock('hero-1', 0, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(placeAgentHosts(document, layer(), hosts)).toEqual(new Set(['hero-1']));
  });

  // The badge hangs 20px past the edge it straddles.
  it('reports a run with less room above it than the marker hangs', () => {
    placeBlock('hero-1', 19, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(placeAgentHosts(document, layer(), hosts)).toEqual(new Set(['hero-1']));
  });

  it('leaves out a run with room above it for the marker', () => {
    placeBlock('hero-1', 20, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(placeAgentHosts(document, layer(), hosts)).toEqual(new Set());
  });

  // At an unzoom of 2 the marker hangs 40 page pixels.
  it('allows for the marker being drawn at the editor’s size in a zoomed page', () => {
    placeBlock('hero-1', 39, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(placeAgentHosts(document, layer(), hosts, 2)).toEqual(new Set(['hero-1']));
  });

  it('leaves out a run with room for the marker at the editor’s size', () => {
    placeBlock('hero-1', 40, 40);
    const hosts = syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());

    expect(placeAgentHosts(document, layer(), hosts, 2)).toEqual(new Set());
  });

  // A block scrolled up to the edge of the frame still has the page above it.
  it('measures that room on the page, not in the viewport', () => {
    scrollPage(300);
    placeBlock('hero-1', -300, 40);
    box(blockFor('text-1'), -180, 40, 600, 200);
    const hosts = syncAgentHosts(
      document,
      layer(),
      new Map([
        ['hero-1', agent()],
        ['text-1', agent({ actorId: 'agent-2' })],
      ]),
      new Map(),
    );

    expect(placeAgentHosts(document, layer(), hosts)).toEqual(new Set(['hero-1']));
  });
});

describe('the marker in the gutter', () => {
  function layer(): HTMLElement {
    const el = agentHostLayer(document);
    if (!el) throw new Error('no layer added');
    return el;
  }

  function gutterMarkers(): NodeListOf<HTMLElement> {
    return mount().querySelectorAll<HTMLElement>('.focus-region-agent-host');
  }

  function heldHero(): Map<string, HTMLElement> {
    return syncAgentHosts(document, layer(), new Map([['hero-1', agent()]]), new Map());
  }

  const FLUSH = new Set(['hero-1']);

  it('gives a run flush with the top of the page its marker in the gutter', () => {
    const markers = syncAgentGutterMarkers(document, mount(), heldHero(), FLUSH, new Map());

    const marker = markers.get('hero-1');
    expect(marker?.parentElement).toBe(mount());
    expect(marker?.className).toBe('focus-region-agent-host');
    expect(marker?.hasAttribute('data-gutter')).toBe(true);
  });

  it('gives the gutter marker a handle of its own', () => {
    const markers = syncAgentGutterMarkers(document, mount(), heldHero(), FLUSH, new Map());

    expect(markers.get('hero-1')?.getAttribute('data-testid')).toBe('agent-block-gutter-marker');
  });

  it('tells the run’s overlay in the page not to draw the marker again', () => {
    const hosts = heldHero();

    syncAgentGutterMarkers(document, mount(), hosts, FLUSH, new Map());

    expect(hosts.get('hero-1')?.hasAttribute('data-gutter-marker')).toBe(true);
  });

  it('leaves a run with room above it to draw its own marker', () => {
    const hosts = heldHero();

    const markers = syncAgentGutterMarkers(document, mount(), hosts, new Set(), new Map());

    expect(markers.size).toBe(0);
    expect(gutterMarkers()).toHaveLength(0);
    expect(hosts.get('hero-1')?.hasAttribute('data-gutter-marker')).toBe(false);
  });

  it('keeps the same marker while the run stays at the top', () => {
    const hosts = heldHero();
    const first = syncAgentGutterMarkers(document, mount(), hosts, FLUSH, new Map());

    const second = syncAgentGutterMarkers(document, mount(), hosts, FLUSH, first);

    // Same map back, so the editor re-renders nothing.
    expect(second).toBe(first);
    expect(gutterMarkers()).toHaveLength(1);
  });

  it('hands the marker back to the page when the run no longer starts at the top', () => {
    const hosts = heldHero();
    const first = syncAgentGutterMarkers(document, mount(), hosts, FLUSH, new Map());

    const second = syncAgentGutterMarkers(document, mount(), hosts, new Set(), first);

    expect(second.size).toBe(0);
    expect(gutterMarkers()).toHaveLength(0);
    expect(hosts.get('hero-1')?.hasAttribute('data-gutter-marker')).toBe(false);
  });

  // The editor rebuilds the canvas when the viewport changes.
  it('moves the marker onto a mount the editor has rebuilt', () => {
    const hosts = heldHero();
    const stale = syncAgentGutterMarkers(document, mount(), hosts, FLUSH, new Map());
    const rebuilt = document.createElement('div');
    document.body.appendChild(rebuilt);

    const markers = syncAgentGutterMarkers(document, rebuilt, hosts, FLUSH, stale);

    expect(markers.get('hero-1')?.parentElement).toBe(rebuilt);
    expect(gutterMarkers()).toHaveLength(0);
  });

  it('takes the marker away with its run', () => {
    const first = syncAgentGutterMarkers(document, mount(), heldHero(), FLUSH, new Map());

    const second = syncAgentGutterMarkers(document, mount(), new Map(), FLUSH, first);

    expect(second.size).toBe(0);
    expect(gutterMarkers()).toHaveLength(0);
  });

  it('fades the marker out with its run', () => {
    vi.useFakeTimers();
    const held = heldHero();
    const markers = syncAgentGutterMarkers(document, mount(), held, FLUSH, new Map());
    const leaving = syncAgentHosts(document, layer(), new Map(), held);

    const fading = syncAgentGutterMarkers(document, mount(), leaving, FLUSH, markers);

    expect(fading.get('hero-1')?.hasAttribute('data-leaving')).toBe(true);
    // Or a second marker would fade in under it.
    expect(leaving.get('hero-1')?.hasAttribute('data-gutter-marker')).toBe(true);
    vi.useRealTimers();
  });

  it('gives a run that is already fading no new marker', () => {
    vi.useFakeTimers();
    const held = heldHero();
    const leaving = syncAgentHosts(document, layer(), new Map(), held);

    const markers = syncAgentGutterMarkers(document, mount(), leaving, FLUSH, new Map());

    expect(markers.size).toBe(0);
    expect(gutterMarkers()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('takes the marker away once the fade has run', () => {
    vi.useFakeTimers();
    const held = heldHero();
    const markers = syncAgentGutterMarkers(document, mount(), held, FLUSH, new Map());
    const leaving = syncAgentHosts(document, layer(), new Map(), held);
    syncAgentGutterMarkers(document, mount(), leaving, FLUSH, markers);

    vi.advanceTimersByTime(AGENT_FADE_MS);

    expect(gutterMarkers()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('brings the marker back when the agent takes the run up again mid-fade', () => {
    vi.useFakeTimers();
    const focusMap = new Map([['hero-1', agent()]]);
    const held = syncAgentHosts(document, layer(), focusMap, new Map());
    const markers = syncAgentGutterMarkers(document, mount(), held, FLUSH, new Map());
    const leaving = syncAgentHosts(document, layer(), new Map(), held);
    const fading = syncAgentGutterMarkers(document, mount(), leaving, FLUSH, markers);

    const retaken = syncAgentHosts(document, layer(), focusMap, leaving);
    const back = syncAgentGutterMarkers(document, mount(), retaken, FLUSH, fading);

    expect(back.get('hero-1')?.hasAttribute('data-leaving')).toBe(false);
    vi.useRealTimers();
  });

  it('gives the marker the colour the run is marked in', () => {
    const markers = syncAgentGutterMarkers(document, mount(), heldHero(), FLUSH, new Map());

    expect(markers.get('hero-1')?.style.getPropertyValue('--focus-color')).toBe('#000000');
  });

  it('lays the marker over its run from outside the page', () => {
    placeBlock('hero-1', 0, 40);

    const markers = syncAgentGutterMarkers(document, mount(), heldHero(), FLUSH, new Map());

    const marker = markers.get('hero-1');
    expect(marker?.style.top).toBe('0px');
    expect(marker?.style.left).toBe('40px');
    expect(marker?.style.getPropertyValue('--agent-clip-top')).toBe('-20px');
  });
});

// The banner is in the page, so the page hears clicks on it too.
describe('a pointer on the overlay itself', () => {
  it('counts as landing in the run the overlay covers', () => {
    const layer = agentHostLayer(document);
    if (!layer) throw new Error('no layer added');
    const hosts = syncAgentHosts(
      document,
      layer,
      new Map([
        ['hero-1', agent()],
        ['text-1', agent()],
      ]),
      new Map(),
    );
    const stop = document.createElement('button');
    hosts.get('hero-1 text-1')?.appendChild(stop);

    expect(agentBlockIdAt(stop)).toBe('hero-1');
  });
});

describe('unzoomAgentLayer', () => {
  function layer(): HTMLElement {
    const el = agentHostLayer(document);
    if (!el) throw new Error('no layer added');
    return el;
  }

  it('scales the overlay back up by as much as the editor zoomed the page down', () => {
    frameLayoutWidth(1600);

    const unzoom = unzoomAgentLayer(layer(), document.getElementById('preview-frame'));

    expect(unzoom).toBe(2);
    expect(layer().style.getPropertyValue('--agent-unzoom')).toBe('2');
  });

  it('leaves the overlay alone in a page drawn at its own size', () => {
    frameLayoutWidth(800);

    expect(unzoomAgentLayer(layer(), document.getElementById('preview-frame'))).toBe(1);
    expect(layer().style.getPropertyValue('--agent-unzoom')).toBe('1');
  });

  it('leaves the overlay alone when there is no frame to measure', () => {
    expect(unzoomAgentLayer(layer(), null)).toBe(1);
    expect(layer().style.getPropertyValue('--agent-unzoom')).toBe('1');
  });
});

describe('observeAgentPageLayout', () => {
  /** Mutation records are delivered after the current task. */
  function settle(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it('calls back when blocks on the page change places', async () => {
    const onChange = vi.fn();
    const stop = observeAgentPageLayout(document, onChange);

    blockFor('hero-1').before(blockFor('text-1'));
    await settle();

    expect(onChange).toHaveBeenCalled();
    stop();
  });

  it('calls back when a block’s text changes', async () => {
    const text = document.createTextNode('before');
    blockFor('hero-1').appendChild(text);
    const onChange = vi.fn();
    const stop = observeAgentPageLayout(document, onChange);

    text.data = 'after';
    await settle();

    expect(onChange).toHaveBeenCalled();
    stop();
  });

  it('ignores what is drawn in the overlays’ own layer', async () => {
    const layer = agentHostLayer(document);
    if (!layer) throw new Error('no layer added');
    const hosts = syncAgentHosts(document, layer, new Map([['hero-1', agent()]]), new Map());
    const onChange = vi.fn();
    const stop = observeAgentPageLayout(document, onChange);

    hosts.get('hero-1')?.appendChild(document.createElement('span'));
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('stops listening once torn down', async () => {
    const onChange = vi.fn();
    const stop = observeAgentPageLayout(document, onChange);

    stop();
    blockFor('hero-1').before(blockFor('text-1'));
    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('agentLayoutTargets', () => {
  function nested(): Map<string, HTMLElement> {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="wrap"><div id="zone">
        <div data-puck-component="cta-1"></div>
        <div data-puck-component="cta-2"></div>
      </div></div>`,
    );
    const layer = agentHostLayer(document);
    if (!layer) throw new Error('no layer added');
    return syncAgentHosts(
      document,
      layer,
      new Map([
        ['cta-1', agent()],
        ['cta-2', agent()],
      ]),
      new Map(),
    );
  }

  it('watches every block an overlay covers', () => {
    const targets = agentLayoutTargets(document, nested());

    expect(targets.has(blockFor('cta-1'))).toBe(true);
    expect(targets.has(blockFor('cta-2'))).toBe(true);
  });

  it('watches everything the blocks sit in, up to the page’s body', () => {
    const targets = agentLayoutTargets(document, nested());

    expect(targets.has(document.getElementById('zone')!)).toBe(true);
    expect(targets.has(document.getElementById('wrap')!)).toBe(true);
    expect(targets.has(document.body)).toBe(true);
    expect(targets.has(document.documentElement)).toBe(false);
  });

  it('watches nothing for a run whose blocks are not drawn', () => {
    const layer = agentHostLayer(document);
    if (!layer) throw new Error('no layer added');
    const hosts = syncAgentHosts(document, layer, new Map([['hero-1', agent()]]), new Map());
    blockFor('hero-1').remove();

    expect(agentLayoutTargets(document, hosts).size).toBe(0);
  });
});
