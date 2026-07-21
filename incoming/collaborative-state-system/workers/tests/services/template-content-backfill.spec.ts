/**
 * PROPOSAL-014 §7: manifest-to-content backfill conversion.
 */

import { describe, it, expect } from 'vitest';
import {
  convertManifestToContent,
  isManifestShapedSnapshot,
} from '../../src/services/template-content-backfill';

describe('isManifestShapedSnapshot', () => {
  it('identifies a manifest-shaped snapshot', () => {
    expect(isManifestShapedSnapshot({ label: 'Blog Post', components: [] })).toBe(true);
  });

  it('rejects a content-shaped snapshot', () => {
    expect(isManifestShapedSnapshot({
      content: [],
      root: { props: { _template: { label: 'Blog Post', deprecated: false }, _pinMap: {} } },
      zones: {},
    })).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isManifestShapedSnapshot(null)).toBe(false);
    expect(isManifestShapedSnapshot(undefined)).toBe(false);
    expect(isManifestShapedSnapshot('components')).toBe(false);
  });
});

describe('convertManifestToContent', () => {
  it('preserves component order in content', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [
        { type: 'HeroBlock', pinned: false, defaultProps: {} },
        { type: 'BodyBlock', pinned: false, defaultProps: {} },
        { type: 'CTABlock', pinned: false, defaultProps: {} },
      ],
    });

    expect(result.content.map((c) => c.type)).toEqual(['HeroBlock', 'BodyBlock', 'CTABlock']);
  });

  it('maps pinned components into root.props._pinMap by generated id', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [
        { type: 'HeroBlock', pinned: true, defaultProps: {} },
        { type: 'BodyBlock', pinned: false, defaultProps: {} },
      ],
    });

    const heroId = result.content[0].props.id as string;
    const bodyId = result.content[1].props.id as string;
    expect(result.root.props._pinMap).toEqual({ [heroId]: true });
    expect(result.root.props._pinMap[bodyId]).toBeUndefined();
  });

  it('moves label, description, defaultUrlPattern, and deprecated into root.props._template', () => {
    const result = convertManifestToContent({
      name: 'blog',
      label: 'Blog Post',
      description: 'Standard blog layout',
      defaultUrlPattern: '/blog/:slug',
      deprecated: true,
      components: [],
    });

    expect(result.root.props._template).toEqual({
      label: 'Blog Post',
      description: 'Standard blog layout',
      defaultUrlPattern: '/blog/:slug',
      deprecated: true,
    });
  });

  it('defaults deprecated to false and omits absent optional metadata', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [],
    });

    expect(result.root.props._template).toEqual({ label: 'Blog Post', deprecated: false });
    expect('description' in result.root.props._template).toBe(false);
    expect('defaultUrlPattern' in result.root.props._template).toBe(false);
  });

  it('drops the manifest name field', () => {
    const result = convertManifestToContent({
      name: 'blog',
      label: 'Blog Post',
      components: [],
    });

    expect('name' in result.root.props._template).toBe(false);
    expect('name' in result).toBe(false);
  });

  it('lifts defaultProps into props alongside a generated id', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [
        { type: 'HeroBlock', pinned: false, defaultProps: { title: '', eyebrow: 'Featured' } },
      ],
    });

    expect(result.content[0].props).toMatchObject({ title: '', eyebrow: 'Featured' });
    expect(typeof result.content[0].props.id).toBe('string');
    expect(result.content[0].props.id).toMatch(/^HeroBlock-/);
  });

  it('generates an id even when defaultProps is absent', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [{ type: 'HeroBlock', pinned: false }],
    });

    expect(typeof result.content[0].props.id).toBe('string');
  });

  it('produces an empty content array and pin map for a template with no components', () => {
    const result = convertManifestToContent({ label: 'Blog Post', components: [] });

    expect(result.content).toEqual([]);
    expect(result.root.props._pinMap).toEqual({});
    expect(result.zones).toEqual({});
  });

  it('lets the generated id win over a defaultProps id so the pin map never orphans', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [
        { type: 'HeroBlock', pinned: true, defaultProps: { id: 'stale-manifest-id', title: '' } },
      ],
    });

    const generatedId = result.content[0].props.id as string;
    expect(generatedId).not.toBe('stale-manifest-id');
    expect(generatedId).toMatch(/^HeroBlock-/);
    expect(result.root.props._pinMap).toEqual({ [generatedId]: true });
  });

  it('gives duplicate component types distinct ids', () => {
    const result = convertManifestToContent({
      label: 'Blog Post',
      components: [
        { type: 'HeroBlock', pinned: false, defaultProps: {} },
        { type: 'HeroBlock', pinned: false, defaultProps: {} },
      ],
    });

    const [first, second] = result.content;
    expect(first.props.id).not.toBe(second.props.id);
    expect(first.props.id).toMatch(/^HeroBlock-/);
    expect(second.props.id).toMatch(/^HeroBlock-/);
  });
});
