/**
 * Upstream apply helper tests
 *
 * applyUpstreamProp sets a single prop value into Puck data at a component's
 * props, addressed by a JSON Pointer. '__root__' targets root props. The input
 * data is never mutated, so the result is safe to feed through the editor's
 * setData dispatch.
 */

import { describe, it, expect } from 'vitest';
import { applyUpstreamProp } from '../../features/localization/upstream-apply.js';

function makeData() {
  return {
    content: [
      { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello', color: '#000' } },
      {
        type: 'CardBlock',
        props: { id: 'CardBlock-1', items: [{ label: 'One' }, { label: 'Two' }] },
      },
    ],
    root: { props: { title: 'Home' } },
    zones: {},
  };
}

describe('applyUpstreamProp', () => {
  it('sets a top-level prop on the addressed component without mutating the input', () => {
    const data = makeData();
    const next = applyUpstreamProp(data, 'HeadingBlock-1', '/title', 'Bonjour');

    expect(next.content[0].props.title).toBe('Bonjour');
    // Sibling props and other components are untouched.
    expect(next.content[0].props.color).toBe('#000');
    expect(next.content[1].props.id).toBe('CardBlock-1');
    // The original object is not mutated.
    expect(data.content[0].props.title).toBe('Hello');
    expect(next).not.toBe(data);
  });

  it('sets a root prop when the component id is __root__', () => {
    const data = makeData();
    const next = applyUpstreamProp(data, '__root__', '/title', 'Accueil');

    expect(next.root.props.title).toBe('Accueil');
    expect(data.root.props.title).toBe('Home');
  });

  it('sets a nested value addressed by a multi-segment JSON Pointer', () => {
    const data = makeData();
    const next = applyUpstreamProp(data, 'CardBlock-1', '/items/1/label', 'Deux');

    const items = next.content[1].props.items as { label: string }[];
    expect(items[1].label).toBe('Deux');
    expect(items[0].label).toBe('One');
    expect((data.content[1].props.items as { label: string }[])[1].label).toBe('Two');
  });

  it('returns the data unchanged when the component id is not found', () => {
    const data = makeData();
    const next = applyUpstreamProp(data, 'Missing-9', '/title', 'x');
    expect(next).toEqual(data);
  });
});

describe('applyUpstreamProp on a component in a zone', () => {
  function withZone() {
    return {
      content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello' } }],
      root: { props: { title: 'Home' } },
      zones: {
        'CardBlock-1:children': [
          { type: 'TextBlock', props: { id: 'TextBlock-9', body: 'Hello', color: '#000' } },
        ],
      },
    };
  }

  it('sets the prop on a component held in a zone', () => {
    const data = withZone();
    const next = applyUpstreamProp(data, 'TextBlock-9', '/body', 'Bonjour');

    expect(next.zones['CardBlock-1:children'][0].props.body).toBe('Bonjour');
    expect(next.zones['CardBlock-1:children'][0].props.color).toBe('#000');
    expect(data.zones['CardBlock-1:children'][0].props.body).toBe('Hello');
    expect(next).not.toBe(data);
  });

  it('leaves the other zones and the top-level content alone', () => {
    const data = withZone();
    data.zones['Other-2:children'] = [{ type: 'TextBlock', props: { id: 'TextBlock-3', body: 'x' } }];
    const next = applyUpstreamProp(data, 'TextBlock-9', '/body', 'Bonjour');

    expect(next.zones['Other-2:children']).toBe(data.zones['Other-2:children']);
    expect(next.content).toBe(data.content);
  });

  it('returns the input when no zone holds the component either', () => {
    const data = withZone();
    expect(applyUpstreamProp(data, 'Missing-4', '/body', 'x')).toBe(data);
  });
});
