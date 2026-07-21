/**
 * Component Registry Utility Tests
 *
 * Tests for serializeField, hashDescriptor, extractDescriptors, and buildRegistryIndex.
 */

import { describe, it, expect } from 'vitest';
import {
  serializeField,
  hashDescriptor,
  extractDescriptors,
  buildRegistryIndex,
  type ComponentDescriptor,
} from '../editor/utils/componentRegistry.js';

describe('serializeField', () => {
  it('serializes a text field', () => {
    const result = serializeField({ type: 'text', label: 'Title' }, 'title');
    expect(result).toEqual({ type: 'text', name: 'title', label: 'Title' });
  });

  it('serializes a select field with options', () => {
    const result = serializeField(
      { type: 'select', label: 'Color', options: [{ label: 'Red', value: 'red' }] },
      'color',
    );
    expect(result).toEqual({
      type: 'select',
      name: 'color',
      label: 'Color',
      options: [{ label: 'Red', value: 'red' }],
    });
  });

  it('serializes a radio field with options', () => {
    const result = serializeField(
      { type: 'radio', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      'variant',
    );
    expect(result).toEqual({
      type: 'radio',
      name: 'variant',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    });
  });

  it('serializes a number field with min/max', () => {
    const result = serializeField({ type: 'number', label: 'Count', min: 1, max: 10 }, 'count');
    expect(result).toEqual({ type: 'number', name: 'count', label: 'Count', min: 1, max: 10 });
  });

  it('serializes an array field with nested fields recursively', () => {
    const result = serializeField(
      {
        type: 'array',
        label: 'Items',
        arrayFields: { title: { type: 'text', label: 'Item Title' } },
      },
      'items',
    );
    expect(result).toEqual({
      type: 'array',
      name: 'items',
      label: 'Items',
      arrayFields: [{ type: 'text', name: 'title', label: 'Item Title' }],
    });
  });

  it('serializes an object field with nested fields recursively', () => {
    const result = serializeField(
      {
        type: 'object',
        label: 'CTA',
        objectFields: { href: { type: 'text', label: 'URL' } },
      },
      'cta',
    );
    expect(result).toEqual({
      type: 'object',
      name: 'cta',
      label: 'CTA',
      objectFields: [{ type: 'text', name: 'href', label: 'URL' }],
    });
  });

  it('treats unknown field types as custom', () => {
    // Puck allows custom field types with render functions — strip the function
    const result = serializeField(
      { type: 'custom', render: () => null, label: 'Rich Text' },
      'body',
    );
    expect(result).toEqual({ type: 'custom', name: 'body', label: 'Rich Text' });
  });

  it('preserves ai metadata when present', () => {
    const result = serializeField(
      { type: 'text', label: 'Headline', ai: { instructions: 'Keep under 10 words', required: true } },
      'headline',
    );
    expect(result).toEqual({
      type: 'text',
      name: 'headline',
      label: 'Headline',
      ai: { instructions: 'Keep under 10 words', required: true },
    });
  });
});

describe('hashDescriptor', () => {
  const base: ComponentDescriptor = {
    name: 'HeroBlock',
    label: 'Hero',
    fields: [{ type: 'text', name: 'title' }],
    defaultProps: { title: '' },
    provenance: 'site',
    descriptorHash: 'PLACEHOLDER',
    registeredAt: '2026-01-01T00:00:00Z',
  };

  it('is deterministic for the same input', () => {
    const h1 = hashDescriptor(base);
    const h2 = hashDescriptor(base);
    expect(h1).toBe(h2);
  });

  it('produces different hashes when a field changes', () => {
    const modified = { ...base, fields: [{ type: 'text' as const, name: 'headline' }] };
    expect(hashDescriptor(base)).not.toBe(hashDescriptor(modified));
  });

  it('excludes descriptorHash and registeredAt from the hash input', () => {
    const a = { ...base, descriptorHash: 'old-hash', registeredAt: '2020-01-01T00:00:00Z' };
    const b = { ...base, descriptorHash: 'new-hash', registeredAt: '2030-01-01T00:00:00Z' };
    expect(hashDescriptor(a)).toBe(hashDescriptor(b));
  });

  it('excludes provenance from the hash input (provenance is classification, not schema identity)', () => {
    // The same component schema should produce the same hash regardless of provenance value
    const site = { ...base, provenance: 'site' as const };
    const upstream = { ...base, provenance: 'upstream' as const };
    const overridden = { ...base, provenance: 'overridden' as const };
    const h = hashDescriptor(site);
    expect(hashDescriptor(upstream)).toBe(h);
    expect(hashDescriptor(overridden)).toBe(h);
  });

  it('excludes upstreamHash from the hash input (upstreamHash is provenance metadata, not schema identity)', () => {
    // A descriptor with upstreamHash set should hash identically to one without it.
    // This prevents hash mismatches when provenance classification changes across registrations.
    const withUpstream = { ...base, upstreamHash: 'abc123' };
    const withoutUpstream = { ...base };
    expect(hashDescriptor(withUpstream)).toBe(hashDescriptor(withoutUpstream));

    // Different upstreamHash values also produce the same hash
    const withDifferentUpstream = { ...base, upstreamHash: 'xyz789' };
    expect(hashDescriptor(withUpstream)).toBe(hashDescriptor(withDifferentUpstream));
  });

  it('is stable across JSON key ordering', () => {
    // JSON.stringify key order should not affect hash
    const orderedFields = { name: 'X', type: 'text' as const };
    const reverseFields = { type: 'text' as const, name: 'X' };
    // Same logical content, may have different key orders — canonicalize by sorting keys
    // (implementation must sort keys before hashing)
    const d1 = { ...base, fields: [orderedFields] };
    const d2 = { ...base, fields: [reverseFields] };
    expect(hashDescriptor(d1)).toBe(hashDescriptor(d2));
  });
});

describe('extractDescriptors', () => {
  const mockConfig = {
    root: {
      fields: { background: { type: 'select', options: [{ label: 'White', value: 'white' }] } },
      defaultProps: { background: 'white' },
    },
    components: {
      HeroBlock: {
        label: 'Hero',
        fields: {
          title: { type: 'text', label: 'Title' },
          body: { type: 'textarea', label: 'Body' },
        },
        defaultProps: { title: 'Hello', body: '' },
      },
      CardBlock: {
        // No label — should default to component name
        fields: {
          items: {
            type: 'array',
            arrayFields: { text: { type: 'text' } },
          },
        },
        defaultProps: { items: [] },
      },
    },
  };

  it('extracts a descriptor for every component in the config including root as __root__', () => {
    const descriptors = extractDescriptors(mockConfig);
    expect(descriptors.map((d) => d.name).sort()).toEqual(['CardBlock', 'HeroBlock', '__root__']);
  });

  it('uses component label when present, falls back to key; root always gets label "Page Root"', () => {
    const descriptors = extractDescriptors(mockConfig);
    const hero = descriptors.find((d) => d.name === 'HeroBlock');
    expect(hero).toBeDefined();
    expect((hero as ComponentDescriptor).label).toBe('Hero');
    const card = descriptors.find((d) => d.name === 'CardBlock');
    expect(card).toBeDefined();
    expect((card as ComponentDescriptor).label).toBe('CardBlock');
    const root = descriptors.find((d) => d.name === '__root__');
    expect(root).toBeDefined();
    expect((root as ComponentDescriptor).label).toBe('Page Root');
  });

  it('serializes fields correctly', () => {
    const descriptors = extractDescriptors(mockConfig);
    const hero = descriptors.find((d) => d.name === 'HeroBlock');
    expect(hero).toBeDefined();
    expect((hero as ComponentDescriptor).fields).toEqual([
      { type: 'text', name: 'title', label: 'Title' },
      { type: 'textarea', name: 'body', label: 'Body' },
    ]);
  });

  it('preserves defaultProps', () => {
    const descriptors = extractDescriptors(mockConfig);
    const hero = descriptors.find((d) => d.name === 'HeroBlock');
    expect(hero).toBeDefined();
    expect((hero as ComponentDescriptor).defaultProps).toEqual({ title: 'Hello', body: '' });
  });

  it('populates descriptorHash and registeredAt', () => {
    const descriptors = extractDescriptors(mockConfig);
    for (const d of descriptors) {
      expect(d.descriptorHash).toBeTruthy();
      expect(d.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('all components get provenance "site" when no upstream provided', () => {
    const descriptors = extractDescriptors(mockConfig);
    for (const d of descriptors) {
      expect(d.provenance).toBe('site');
    }
  });

  it('root descriptor has correct field serialization', () => {
    const descriptors = extractDescriptors(mockConfig);
    const root = descriptors.find((d) => d.name === '__root__');
    expect(root).toBeDefined();
    expect((root as ComponentDescriptor).fields).toEqual([
      { type: 'select', name: 'background', options: [{ label: 'White', value: 'white' }] },
    ]);
    expect((root as ComponentDescriptor).defaultProps).toEqual({ background: 'white' });
  });

  it('handles config with no root gracefully', () => {
    const descriptors = extractDescriptors({ components: { HeroBlock: { label: 'Hero', fields: {}, defaultProps: {} } } });
    expect(descriptors.map((d) => d.name)).not.toContain('__root__');
  });

  it('handles empty components config gracefully', () => {
    const descriptors = extractDescriptors({ components: {} });
    expect(descriptors).toEqual([]);
  });
});

describe('extractDescriptors with upstream', () => {
  const siteConfig = {
    components: {
      SharedBlock: { label: 'Shared', fields: { text: { type: 'text' } }, defaultProps: { text: '' } },
      SiteOnlyBlock: { label: 'Site Only', fields: {}, defaultProps: {} },
      ModifiedBlock: { label: 'Modified', fields: { title: { type: 'text' } }, defaultProps: { title: '' } },
    },
  };

  const upstreamConfig = {
    components: {
      SharedBlock: { label: 'Shared', fields: { text: { type: 'text' } }, defaultProps: { text: '' } },
      ModifiedBlock: { label: 'Original', fields: { title: { type: 'textarea' } }, defaultProps: { title: '' } },
    },
  };

  it('marks component as "upstream" when site and upstream hashes match', () => {
    const descriptors = extractDescriptors(siteConfig, upstreamConfig);
    const shared = descriptors.find((d) => d.name === 'SharedBlock');
    expect(shared).toBeDefined();
    expect((shared as ComponentDescriptor).provenance).toBe('upstream');
    expect((shared as ComponentDescriptor).upstreamHash).toBeTruthy();
  });

  it('marks component as "site" when not present in upstream', () => {
    const descriptors = extractDescriptors(siteConfig, upstreamConfig);
    const siteOnly = descriptors.find((d) => d.name === 'SiteOnlyBlock');
    expect(siteOnly).toBeDefined();
    expect((siteOnly as ComponentDescriptor).provenance).toBe('site');
    expect((siteOnly as ComponentDescriptor).upstreamHash).toBeUndefined();
  });

  it('marks component as "overridden" when hashes differ', () => {
    const descriptors = extractDescriptors(siteConfig, upstreamConfig);
    const modified = descriptors.find((d) => d.name === 'ModifiedBlock');
    expect(modified).toBeDefined();
    expect((modified as ComponentDescriptor).provenance).toBe('overridden');
    expect((modified as ComponentDescriptor).upstreamHash).toBeTruthy();
  });
});

describe('buildRegistryIndex', () => {
  it('builds a RegistryIndex from a list of descriptors', () => {
    const descriptors: ComponentDescriptor[] = [
      { name: 'HeroBlock', label: 'Hero', fields: [], defaultProps: {}, provenance: 'site', descriptorHash: 'abc', registeredAt: '2026-01-01T00:00:00Z' },
      { name: 'CardBlock', label: 'Card', fields: [], defaultProps: {}, provenance: 'upstream', descriptorHash: 'def', registeredAt: '2026-01-01T00:00:00Z' },
    ];

    const index = buildRegistryIndex(descriptors, 'site-1', 'branch-1');

    expect(index.siteId).toBe('site-1');
    expect(index.branchId).toBe('branch-1');
    expect(index.componentNames).toEqual(['HeroBlock', 'CardBlock']);
    expect(index.provenance).toEqual({ HeroBlock: 'site', CardBlock: 'upstream' });
    expect(index.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
