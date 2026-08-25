/**
 * Backend skeleton generation from a content-shaped template.
 *
 * A document created from a template inherits the template's component slot
 * ids: the backend deep-copies the template's content and zones, preserving
 * each component's props.id, and seeds a fresh root from the document's own
 * metadata. Template-authoring root props (the pin map and template
 * descriptor) do not carry into the created document.
 *
 * PROPOSAL-015 Design 2, 3, 4.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentSkeletonFromTemplate } from '../../src/services/document-skeleton';

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

function contentTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: [
      comp('HeroBlock', 'HeroBlock-aaaa', { title: 'Default hero' }),
      comp('BodyBlock', 'BodyBlock-bbbb', { text: '' }),
    ],
    zones: {},
    root: {
      props: {
        name: 'blog',
        label: 'Blog Post',
        _pinMap: { 'HeroBlock-aaaa': true },
        _template: { defaultUrlPattern: '/blog/:slug' },
      },
    },
    ...overrides,
  };
}

describe('buildDocumentSkeletonFromTemplate', () => {
  it('copies template content in order, preserving each component slot id', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate());

    expect(skeleton.content.map((c) => c.props.id)).toEqual(['HeroBlock-aaaa', 'BodyBlock-bbbb']);
    expect(skeleton.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock']);
  });

  it('carries component prop defaults from the template', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate());

    expect(skeleton.content[0].props.title).toBe('Default hero');
  });

  it('copies zones, preserving zone component slot ids and props', () => {
    const template = contentTemplate({
      zones: { 'HeroBlock-aaaa:cta': [comp('CtaBlock', 'CtaBlock-cccc', { label: 'Go' })] },
    });

    const skeleton = buildDocumentSkeletonFromTemplate(template);

    expect(skeleton.zones['HeroBlock-aaaa:cta'][0].props.id).toBe('CtaBlock-cccc');
    expect(skeleton.zones['HeroBlock-aaaa:cta'][0].props.label).toBe('Go');
  });

  it('returns empty zones when the template has none', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate());

    expect(skeleton.zones).toEqual({});
  });

  it('seeds root props with the document title from meta', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate(), { title: 'My First Post' });

    expect(skeleton.root.props.title).toBe('My First Post');
  });

  it('omits the title when meta provides none', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate());

    expect(skeleton.root.props.title).toBeUndefined();
  });

  it('does not carry template-authoring root props into the document', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate(), { title: 'X' });

    expect(skeleton.root.props._pinMap).toBeUndefined();
    expect(skeleton.root.props._template).toBeUndefined();
    expect(skeleton.root.props.name).toBeUndefined();
    expect(skeleton.root.props.label).toBeUndefined();
  });

  it('produces a document whose content is independent of the template input', () => {
    const template = contentTemplate();

    const skeleton = buildDocumentSkeletonFromTemplate(template);
    (skeleton.content[0].props).title = 'mutated';

    expect((template.content as Comp[])[0].props.title).toBe('Default hero');
  });

  it('carries the template page-metadata defaults into the document', () => {
    const template = contentTemplate({
      root: {
        props: {
          _pinMap: {},
          _template: { defaultUrlPattern: '/blog/:slug' },
          _meta: { ogType: 'article', ogTitle: 'From the blog' },
        },
      },
    });

    const skeleton = buildDocumentSkeletonFromTemplate(template, { title: 'My First Post' });

    expect(skeleton.root.props._meta).toEqual({ ogType: 'article', ogTitle: 'From the blog' });
  });

  it('omits _meta when the template has none, leaving output byte-identical', () => {
    const skeleton = buildDocumentSkeletonFromTemplate(contentTemplate(), { title: 'X' });

    expect(Object.keys(skeleton.root.props)).toEqual(['title']);
  });

  it('carries a field the template left empty as empty', () => {
    // Copying at create time makes a template value indistinguishable from an
    // authored one, so it outranks the site default. A field the template left
    // blank must stay blank rather than becoming an authored empty that wins:
    // `buildPageMetadata` treats it as falsy and falls through to the site tier.
    const template = contentTemplate({
      root: { props: { _meta: { ogTitle: 'From the blog', ogImage: '' } } },
    });

    const skeleton = buildDocumentSkeletonFromTemplate(template);

    expect(skeleton.root.props._meta).toEqual({ ogTitle: 'From the blog', ogImage: '' });
  });

  it('does not carry a non-object _meta', () => {
    const template = contentTemplate({ root: { props: { _meta: 'not an object' } } });

    const skeleton = buildDocumentSkeletonFromTemplate(template);

    expect(skeleton.root.props._meta).toBeUndefined();
  });

  it('produces a _meta independent of the template input', () => {
    const template = contentTemplate({ root: { props: { _meta: { ogTitle: 'From the blog' } } } });

    const skeleton = buildDocumentSkeletonFromTemplate(template);
    (skeleton.root.props._meta as Record<string, unknown>).ogTitle = 'mutated';

    const templateMeta = (template.root as { props: { _meta: Record<string, unknown> } }).props._meta;
    expect(templateMeta.ogTitle).toBe('From the blog');
  });

  it('yields an empty skeleton for a template that has no content array', () => {
    // A template lacking a content array (the pre-cutover manifest shape) is
    // not the content shape this builder targets and yields no components.
    const manifest = { components: [{ type: 'HeroBlock', pinned: true, defaultProps: {} }] };

    const skeleton = buildDocumentSkeletonFromTemplate(manifest);

    expect(skeleton.content).toEqual([]);
    expect(skeleton.zones).toEqual({});
  });
});
