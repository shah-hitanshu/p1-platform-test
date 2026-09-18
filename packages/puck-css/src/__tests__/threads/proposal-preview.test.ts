import { describe, it, expect } from 'vitest';

import { describeChange } from '../../features/threads/proposal-preview.js';

const page = {
  data: {
    content: [
      { type: 'HeroBlock', props: { id: 'a', title: 'Old title', items: [{ text: 'one' }, { text: 'two' }] } },
      { type: 'FaqBlock', props: { id: 'b', question: '<p>Why?</p>' } },
    ],
  },
  config: { components: { HeroBlock: { label: 'Hero', fields: { title: { label: 'Headline' } } } } },
};

describe('describeChange', () => {
  it('names the block and field from the config and reads the value in place', () => {
    const change = describeChange({ op: 'replace', path: 'content.0.props.title', value: 'New' }, page);
    expect(change).toMatchObject({ block: 'Hero', field: 'Headline', before: 'Old title', after: 'New' });
  });

  it('humanizes a block and field the config does not label, and strips markup', () => {
    const change = describeChange({ op: 'replace', path: 'content.1.props.question', value: '<p>How?</p>' }, page);
    expect(change).toMatchObject({ block: 'FAQ', field: 'Question', before: 'Why?', after: 'How?' });
  });

  it('keeps the outer field for a change deep inside it and counts a list', () => {
    const change = describeChange({ op: 'remove', path: 'content.0.props.items.1' }, page);
    expect(change).toMatchObject({ block: 'Hero', field: 'Items', after: undefined });
    expect(describeChange({ op: 'replace', path: 'content.0.props.items', value: [] }, page).before).toBe('2 items');
  });

  it('names an added block by its type', () => {
    const change = describeChange({ op: 'add', path: 'content.2', value: { type: 'CtaBannerBlock', props: {} } }, page);
    expect(change).toMatchObject({ block: 'CTA Banner', before: undefined, after: 'CTA Banner' });
  });

  it('decodes each entity once, so an escaped entity stays escaped', () => {
    const value = '<p>&amp;lt;b&amp;gt; is how Tom &amp; Jerry write a tag</p>';
    const change = describeChange({ op: 'replace', path: 'content.1.props.question', value }, page);
    expect(change.after).toBe('&lt;b&gt; is how Tom & Jerry write a tag');
  });

  it('reads the field off the path alone when there is no page', () => {
    const change = describeChange({ op: 'replace', path: 'content.0.props.subTitle', value: 'x' });
    expect(change).toMatchObject({ block: undefined, field: 'Sub Title', before: undefined, after: 'x' });
  });
});
