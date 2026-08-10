import { describe, expect, it } from 'vitest';

import { sanitizeRichtextDefaults } from '../editor/utils/sanitizeRichtextDefaults.js';

describe('sanitizeRichtextDefaults', () => {
  it('drops an empty-string richtext default', () => {
    const config = {
      components: {
        TextSection: {
          fields: { body: { type: 'richtext' }, heading: { type: 'text' } },
          defaultProps: { body: '', heading: '' },
        },
      },
    };

    const result = sanitizeRichtextDefaults(config);

    expect('body' in result.components.TextSection.defaultProps).toBe(false);
    // Only richtext is fatal — a plain text field may legitimately default to "".
    expect(result.components.TextSection.defaultProps.heading).toBe('');
  });

  it('leaves non-empty richtext defaults alone', () => {
    const config = {
      components: {
        Paragraph: {
          fields: { body: { type: 'richtext' } },
          defaultProps: { body: '<p>Add your copy here.</p>' },
        },
      },
    };

    expect(sanitizeRichtextDefaults(config).components.Paragraph.defaultProps.body).toBe(
      '<p>Add your copy here.</p>',
    );
  });

  it('returns the same reference when there is nothing to strip', () => {
    const config = {
      components: {
        Paragraph: {
          fields: { body: { type: 'richtext' } },
          defaultProps: { body: 'copy' },
        },
      },
    };

    // Identity matters: Puck memoizes on config/defaultProps identity.
    expect(sanitizeRichtextDefaults(config)).toBe(config);
  });

  it('returns the same reference when an array field has nothing to strip', () => {
    const config = {
      components: {
        FeatureGrid: {
          fields: {
            items: { type: 'array', arrayFields: { body: { type: 'richtext' } } },
          },
          defaultProps: { items: [{ body: 'kept' }] },
        },
      },
    };

    expect(sanitizeRichtextDefaults(config)).toBe(config);
  });

  it('strips richtext inside array items', () => {
    const config = {
      components: {
        FeatureGrid: {
          fields: {
            items: {
              type: 'array',
              arrayFields: { body: { type: 'richtext' }, title: { type: 'text' } },
            },
          },
          defaultProps: { items: [{ body: '', title: 'One' }, { body: 'kept', title: 'Two' }] },
        },
      },
    };

    const items = sanitizeRichtextDefaults(config).components.FeatureGrid.defaultProps.items as
      Record<string, unknown>[];

    expect('body' in items[0]!).toBe(false);
    expect(items[0]!.title).toBe('One');
    expect(items[1]!.body).toBe('kept');
  });

  it('strips richtext inside object fields', () => {
    const config = {
      components: {
        Card: {
          fields: {
            tile: { type: 'object', objectFields: { intro: { type: 'richtext' } } },
          },
          defaultProps: { tile: { intro: '' } },
        },
      },
    };

    const tile = sanitizeRichtextDefaults(config).components.Card.defaultProps.tile as
      Record<string, unknown>;

    expect('intro' in tile).toBe(false);
  });

  it('sanitizes root defaults', () => {
    const config = {
      root: {
        fields: { intro: { type: 'richtext' } },
        defaultProps: { intro: '' },
      },
    };

    expect('intro' in sanitizeRichtextDefaults(config).root.defaultProps).toBe(false);
  });

  it('tolerates components with no fields or no defaultProps', () => {
    const config = {
      components: {
        NoDefaults: { fields: { body: { type: 'richtext' } } },
        NoFields: { defaultProps: { body: '' } },
      },
    };

    expect(() => sanitizeRichtextDefaults(config)).not.toThrow();
    expect(sanitizeRichtextDefaults(config)).toBe(config);
  });

  it('leaves other empty values on richtext fields untouched', () => {
    // undefined and null both normalize to an empty doc downstream; only "" throws.
    const config = {
      components: {
        A: {
          fields: { body: { type: 'richtext' } },
          defaultProps: { body: null },
        },
      },
    };

    expect(sanitizeRichtextDefaults(config).components.A.defaultProps.body).toBe(null);
  });
});
