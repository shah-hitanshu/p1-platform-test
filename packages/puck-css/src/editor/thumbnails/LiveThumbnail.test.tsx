import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// Capture what LiveThumbnail passes to Puck's <Render>, and emit a marker so
// the cache-capture path has observable HTML. `renderOutput` lets a single
// test swap in a stateful component (e.g. to simulate a component that
// finishes rendering asynchronously in its own effect) without affecting the
// default fixed-markup behavior every other test relies on.
const { renderSpy, renderOutput } = vi.hoisted(() => ({
  renderSpy: vi.fn((_props: unknown) => null),
  renderOutput: { current: null as unknown },
}));
vi.mock('@puckeditor/core', async () => {
  const ReactMod = await import('react');
  return {
    Render: (props: unknown) => {
      renderSpy(props);
      return renderOutput.current ?? ReactMod.createElement('span', null, 'LIVE-PREVIEW');
    },
  };
});

import { LiveThumbnail } from './LiveThumbnail.js';
import {
  makeThumbnailKey,
  getCachedThumbnail,
  setCachedThumbnail,
  clearThumbnailCache,
} from './thumbnailCache.js';

const config = {
  components: {
    HeroBlock: { defaultProps: { heading: 'Hi', tone: 'dark' }, render: () => null },
    BareBlock: { render: () => null },
  },
};

beforeEach(() => {
  clearThumbnailCache();
  renderSpy.mockClear();
  renderOutput.current = null;
});

afterEach(() => {
  renderOutput.current = null;
});

describe('LiveThumbnail', () => {
  it('renders the named component with its defaultProps and a generated id', () => {
    render(<LiveThumbnail config={config} name="HeroBlock" />);

    expect(renderSpy).toHaveBeenCalledTimes(1);

    const { config: passedConfig, data } = renderSpy.mock.calls[0][0] as any;
    expect(passedConfig.components).toBe(config.components);
    expect(data.content).toHaveLength(1);
    expect(data.content[0].type).toBe('HeroBlock');
    expect(data.content[0].props).toMatchObject({ heading: 'Hi', tone: 'dark' });
    expect(data.content[0].props.id).toBeTruthy();
    expect(data.root).toEqual({ props: {} });
  });

  it('isolates the preview from the real page root, even if the site defines one', () => {
    const configWithRoot = {
      ...config,
      root: {
        render: ({ children }: { children?: unknown }) =>

          ({ type: 'h1-wrapper', children } as any),
      },
    };
    render(<LiveThumbnail config={configWithRoot} name="HeroBlock" />);


    const { config: passedConfig } = renderSpy.mock.calls[0][0] as any;
    // The site's real root.render must never reach Puck's <Render> here —
    // a page-level wrapper (e.g. a title <h1>) would otherwise leak the
    // real, currently-open document's data into an isolated component preview.
    expect(passedConfig.root.render).not.toBe(configWithRoot.root.render);
    expect(passedConfig.root.render({ children: 'X' })).toBe('X');
  });

  it('handles a component with no defaultProps', () => {
    render(<LiveThumbnail config={config} name="BareBlock" />);


    const { data } = renderSpy.mock.calls[0][0] as any;
    expect(data.content[0].type).toBe('BareBlock');
    expect(data.content[0].props).toEqual({ id: expect.any(String) });
  });

  it('scales the preview and clips it to a fixed height', () => {
    const { container } = render(
      <LiveThumbnail config={config} name="HeroBlock" scale={0.2} height={70} />,
    );

    const box = container.firstChild as HTMLElement;
    expect(box.style.height).toBe('70px');
    expect(box.style.overflow).toBe('hidden');

    const inner = box.firstChild as HTMLElement;
    expect(inner.style.transform).toBe('scale(0.2)');
    expect(inner.style.transformOrigin).toBe('top left');
  });

  it('disables pointer events so the preview is non-interactive', () => {
    const { container } = render(<LiveThumbnail config={config} name="HeroBlock" />);

    const box = container.firstChild as HTMLElement;
    expect(box.style.pointerEvents).toBe('none');
  });

  it('caches the rendered HTML on a cache miss', () => {
    render(<LiveThumbnail config={config} name="HeroBlock" />);

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const key = makeThumbnailKey('HeroBlock', config.components.HeroBlock.defaultProps);
    expect(getCachedThumbnail(key)).toContain('LIVE-PREVIEW');
  });

  it('re-captures the cache if the component finishes rendering asynchronously', async () => {
    // Simulates a component that shows a loading state on its first commit,
    // then swaps in real content from its own effect (e.g. after a fetch) —
    // the kind of component the initial, one-shot capture would otherwise
    // freeze mid-loading, forever.
    function AsyncBlock() {
      const [text, setText] = React.useState('LOADING');
      React.useEffect(() => {
        setText('SETTLED');
      }, []);
      return React.createElement('span', null, text);
    }
    renderOutput.current = React.createElement(AsyncBlock);

    render(<LiveThumbnail config={config} name="HeroBlock" />);

    const key = makeThumbnailKey('HeroBlock', config.components.HeroBlock.defaultProps);
    await waitFor(() => expect(getCachedThumbnail(key)).toContain('SETTLED'));
    // The transient loading state must not be what's permanently cached.
    expect(getCachedThumbnail(key)).not.toContain('LOADING');
  });

  it('reuses a cached preview and skips the live render', () => {
    const key = makeThumbnailKey('HeroBlock', config.components.HeroBlock.defaultProps);
    setCachedThumbnail(key, '<span>CACHED-HTML</span>');

    const { container } = render(<LiveThumbnail config={config} name="HeroBlock" />);

    expect(renderSpy).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('CACHED-HTML');
  });
});
