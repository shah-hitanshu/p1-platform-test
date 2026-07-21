import type { Config, Data } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';

import {
  encodePagesBlocksTemplate,
  flattenComponents,
  getBlockPropsById,
  getRawPropValue,
  isCrossPageRefTemplateString,
  isPagesBlocksTemplateString,
  listConnectablePropKeys,
  CROSS_PAGE_REF_REGEX,
  MAX_XREF_DEPTH,
} from '../../data/cross-reference';

const minimalConfig = {
  root: { fields: { title: { type: 'text' } }, render: () => null },
  components: {
    HeadingBlock: { fields: { title: { type: 'text' } }, render: () => null },
  },
} as unknown as Config;

describe('cross-reference', () => {
  it('encodes readable pages/blocks/props templates', () => {
    expect(encodePagesBlocksTemplate('/', 'ImageBlock-abc', 'src')).toBe(
      '{{ pages["/"].blocks["ImageBlock-abc"].props.src }}'
    );
    expect(encodePagesBlocksTemplate('/about/', 'root', 'title')).toBe(
      '{{ pages["/about"].blocks["root"].props.title }}'
    );
  });

  it('detects pages/blocks templates and combined cross-page refs', () => {
    const readable = encodePagesBlocksTemplate('/', 'h1', 'title');
    expect(isPagesBlocksTemplateString(readable)).toBe(true);
    expect(isCrossPageRefTemplateString(readable)).toBe(true);
  });

  it('reads root and block props', () => {
    const data = {
      root: { props: { title: 'Root title' } },
      content: [
        { type: 'HeadingBlock', props: { id: 'h1', title: 'Hello' } },
      ],
      zones: {},
    } as unknown as Data;
    expect(getRawPropValue(data, 'root', 'title')).toBe('Root title');
    expect(getRawPropValue(data, 'h1', 'title')).toBe('Hello');
  });

  it('getBlockPropsById returns props for root and blocks', () => {
    const data = {
      root: { props: { title: 'T' } },
      content: [{ type: 'HeadingBlock', props: { id: 'h1', title: 'Hello' } }],
      zones: {},
    } as unknown as Data;
    expect(getBlockPropsById(data, 'root')?.title).toBe('T');
    expect(getBlockPropsById(data, 'puck-root')?.title).toBe('T');
    expect(getBlockPropsById(data, 'h1')?.title).toBe('Hello');
  });

  it('reads nested props with dotted paths', () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'Block',
          props: { id: 'b1', meta: { alt: 'A' } },
        },
      ],
      zones: {},
    } as unknown as Data;
    expect(getRawPropValue(data, 'b1', 'meta.alt')).toBe('A');
  });

  it('flattens components with root first', () => {
    const data = {
      root: { props: {} },
      content: [{ type: 'HeadingBlock', props: { id: 'x', title: 'T' } }],
      zones: {},
    } as unknown as Data;
    const flat = flattenComponents(data, minimalConfig);
    expect(flat[0]?.id).toBe('root');
    expect(flat.some((c) => c.id === 'x')).toBe(true);
  });

  it('exports CROSS_PAGE_REF_REGEX as a regex', () => {
    expect(CROSS_PAGE_REF_REGEX).toBeInstanceOf(RegExp);
  });

  it('exports MAX_XREF_DEPTH as 10', () => {
    expect(MAX_XREF_DEPTH).toBe(10);
  });

  it('listConnectablePropKeys returns text-like fields', () => {
    const keys = listConnectablePropKeys(minimalConfig, 'HeadingBlock');
    expect(keys).toContain('title');
  });

  it('listConnectablePropKeys handles root fields', () => {
    const keys = listConnectablePropKeys(minimalConfig, 'root');
    expect(keys).toContain('title');
  });
});
