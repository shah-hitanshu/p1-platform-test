/**
 * Tests for dataToUpdateParams — builds the "complete template" update payload
 * (metadata + components) from the live Puck canvas + pin map.
 *
 * This is the core of the client-side "canvas is source of truth" save: a
 * template's components are derived from the canvas content (each block's props
 * become defaultProps, with the id stripped), with pinned status from the pin
 * map. Sending these alongside metadata is what stops the backend full-replace
 * from wiping the component skeleton on a "Save details".
 */

import { describe, it, expect } from 'vitest';
import { dataToUpdateParams } from './dataToTemplate.js';

const data = {
  content: [
    { type: 'HeadingBlock', props: { id: 'h1', text: 'Bike name' } },
    { type: 'TextBlock', props: { id: 't1', text: 'Add your copy here.' } },
  ],
  root: { props: {} },
};

describe('dataToUpdateParams', () => {
  it('derives components from canvas content, stripping the id into defaultProps', () => {
    const params = dataToUpdateParams(data, new Map(), {
      label: 'Bike',
    });
    expect(params.components).toEqual([
      { type: 'HeadingBlock', pinned: false, defaultProps: { text: 'Bike name' } },
      { type: 'TextBlock', pinned: false, defaultProps: { text: 'Add your copy here.' } },
    ]);
  });

  it('reflects pinned status from the pin map', () => {
    const pinMap = new Map<string, boolean>([['h1', true]]);
    const params = dataToUpdateParams(data, pinMap, { label: 'Bike' });
    expect(params.components?.[0]).toEqual({
      type: 'HeadingBlock',
      pinned: true,
      defaultProps: { text: 'Bike name' },
    });
    expect(params.components?.[1].pinned).toBe(false);
  });

  it('passes metadata through', () => {
    const params = dataToUpdateParams(data, new Map(), {
      label: 'Bike',
      description: 'A bike template',
      defaultUrlPattern: '/bike/:model',
    });
    expect(params.label).toBe('Bike');
    expect(params.description).toBe('A bike template');
    expect(params.defaultUrlPattern).toBe('/bike/:model');
  });

  it('produces an empty components array for an empty canvas', () => {
    const params = dataToUpdateParams({ content: [], root: { props: {} } }, new Map(), {
      label: 'Bike',
    });
    expect(params.components).toEqual([]);
  });
});
