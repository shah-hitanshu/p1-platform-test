import { describe, it, expect } from 'vitest';
import { validateDocumentStructure } from '../src/index.js';
import type { TemplateSnapshot } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

function component(
  type: string,
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type, props: { id: TEST_UUID, ...props } };
}

function template(
  entries: {
    type: string;
    id: string;
    pinned: boolean;
    props?: Record<string, unknown>;
  }[],
): TemplateSnapshot {
  return {
    content: entries.map(({ type, id, props = {} }) => ({
      type,
      props: { id, ...props },
    })),
    root: {
      props: {
        _pinMap: Object.fromEntries(
          entries.map(({ id, pinned }) => [id, pinned]),
        ),
      },
    },
    zones: {},
  };
}

// Template with all pinned components
const blogTemplate = template([
  { type: 'HeroBlock', id: 'hero-1', pinned: true, props: { title: '', subtitle: '' } },
  { type: 'BodyBlock', id: 'body-1', pinned: true, props: { content: '' } },
  { type: 'CTABlock', id: 'cta-1', pinned: true, props: { label: '', url: '' } },
]);

// Template with mixed pinned/non-pinned components
const productTemplate = template([
  { type: 'HeroBlock', id: 'hero-1', pinned: true, props: { title: '' } },
  { type: 'FeaturesBlock', id: 'features-1', pinned: false, props: { items: [] } },
  { type: 'CTABlock', id: 'cta-1', pinned: true, props: { label: '' } },
]);

// Empty template (no components)
const emptyTemplate = template([]);

// ---------------------------------------------------------------------------
// validateDocumentStructure — structural conformance validation
// ---------------------------------------------------------------------------

describe('validateDocumentStructure', () => {
  describe('valid conformance', () => {
    it('returns no errors when all pinned components are present and in order', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              component('BodyBlock', { content: 'Content here' }),
              component('CTABlock', { label: 'Click me' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('allows extra non-pinned components between pinned components', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              component('StatsBlock', { stats: [] }), // extra non-pinned component
              component('BodyBlock', { content: 'Content' }),
              component('TestimonialsBlock', { quotes: [] }), // extra non-pinned component
              component('CTABlock', { label: 'Click' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('returns no errors for empty document when template has no components', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: emptyTemplate,
      });

      expect(errors).toHaveLength(0);
    });
  });

  describe('pinned derivation from template content', () => {
    it('does not require components whose pin map entry is false', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              component('CTABlock', { label: 'Click' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: productTemplate, // FeaturesBlock is unpinned
      });

      expect(errors).toHaveLength(0);
    });

    it('treats a missing pin map as nothing pinned', () => {
      const content = [
        { type: 'HeroBlock', props: { id: 'hero-1', title: '' } },
        { type: 'BodyBlock', props: { id: 'body-1', content: '' } },
      ];
      const emptyDocument = { root: { props: { content: [] } } };

      // No _pinMap: an empty document conforms because nothing is pinned.
      expect(
        validateDocumentStructure({
          documentSnapshot: emptyDocument,
          templateSnapshot: { content, root: { props: {} }, zones: {} },
        }).errors,
      ).toHaveLength(0);

      // The same template with a pin map does require those components,
      // proving the empty result above comes from the absent map, not from
      // the validator ignoring the template.
      expect(
        validateDocumentStructure({
          documentSnapshot: emptyDocument,
          templateSnapshot: {
            content,
            root: { props: { _pinMap: { 'hero-1': true, 'body-1': true } } },
            zones: {},
          },
        }).errors,
      ).toHaveLength(2);
    });

    it('requires only the mapped component when an id is absent from the pin map', () => {
      // hero-1 is pinned via the map; body-1 is absent from it.
      const templateSnapshot: TemplateSnapshot = {
        content: [
          { type: 'HeroBlock', props: { id: 'hero-1', title: '' } },
          { type: 'BodyBlock', props: { id: 'body-1', content: '' } },
        ],
        root: { props: { _pinMap: { 'hero-1': true } } },
        zones: {},
      };

      // A document with only HeroBlock conforms — BodyBlock is not pinned.
      expect(
        validateDocumentStructure({
          documentSnapshot: {
            root: { props: { content: [component('HeroBlock', { title: 'Welcome' })] } },
          },
          templateSnapshot,
        }).errors,
      ).toHaveLength(0);

      // Dropping HeroBlock fails: the mapped entry is genuinely enforced,
      // while the unmapped BodyBlock never triggers an error.
      const { errors } = validateDocumentStructure({
        documentSnapshot: { root: { props: { content: [] } } },
        templateSnapshot,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('HeroBlock');
    });

    it('treats a component without an id as unpinned', () => {
      // HeroBlock has no id so it can never key into the map; body-1 is pinned.
      const templateSnapshot: TemplateSnapshot = {
        content: [
          { type: 'HeroBlock', props: { title: '' } }, // no id
          { type: 'BodyBlock', props: { id: 'body-1', content: '' } },
        ],
        root: { props: { _pinMap: { 'body-1': true } } },
        zones: {},
      };

      // A document with only BodyBlock conforms: the id-less HeroBlock is
      // not required.
      expect(
        validateDocumentStructure({
          documentSnapshot: {
            root: { props: { content: [component('BodyBlock', { content: 'Content' })] } },
          },
          templateSnapshot,
        }).errors,
      ).toHaveLength(0);

      // An empty document fails only on the pinned BodyBlock — the id-less
      // HeroBlock never produces an error.
      const { errors } = validateDocumentStructure({
        documentSnapshot: { root: { props: { content: [] } } },
        templateSnapshot,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].componentType).toBe('BodyBlock');
    });

    it('treats non-boolean pin map values as unpinned', () => {
      const content = [{ type: 'HeroBlock', props: { id: 'hero-1', title: '' } }];
      const emptyDocument = { root: { props: { content: [] } } };

      // A string "true" is not the boolean true, so hero-1 is not pinned.
      expect(
        validateDocumentStructure({
          documentSnapshot: emptyDocument,
          templateSnapshot: {
            content,
            root: { props: { _pinMap: { 'hero-1': 'true' as unknown as boolean } } },
            zones: {},
          },
        }).errors,
      ).toHaveLength(0);

      // The boolean true does pin it — confirming only strict === true counts.
      expect(
        validateDocumentStructure({
          documentSnapshot: emptyDocument,
          templateSnapshot: { content, root: { props: { _pinMap: { 'hero-1': true } } }, zones: {} },
        }).errors,
      ).toHaveLength(1);
    });

    it('pins per instance when the same type appears pinned and unpinned', () => {
      const templateSnapshot = template([
        { type: 'HeroBlock', id: 'hero-1', pinned: true, props: { title: '' } },
        { type: 'BodyBlock', id: 'body-1', pinned: true, props: { content: '' } },
        { type: 'HeroBlock', id: 'hero-2', pinned: false, props: { title: '' } },
      ]);

      // One HeroBlock satisfies the single pinned instance
      const conforming = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              component('BodyBlock', { content: 'Content' }),
            ],
          },
        },
      };

      expect(
        validateDocumentStructure({
          documentSnapshot: conforming,
          templateSnapshot,
        }).errors,
      ).toHaveLength(0);

      // Only the pinned instance is required: a lone HeroBlock is missing BodyBlock, not a second HeroBlock
      const missingBody = {
        root: {
          props: {
            content: [component('HeroBlock', { title: 'Welcome' })],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot: missingBody,
        templateSnapshot,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('BodyBlock');
    });
  });

  describe('missing_pinned_component', () => {
    it('detects when a pinned component is missing', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              // BodyBlock missing
              component('CTABlock', { label: 'Click' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('BodyBlock');
      expect(errors[0].message).toContain('BodyBlock');
      expect(errors[0].message).toContain('missing');
    });

    it('detects all missing pinned components in empty document', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(3);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('HeroBlock');
      expect(errors[1].code).toBe('missing_pinned_component');
      expect(errors[1].componentType).toBe('BodyBlock');
      expect(errors[2].code).toBe('missing_pinned_component');
      expect(errors[2].componentType).toBe('CTABlock');
    });
  });

  describe('unexpected_component_at_pinned_slot', () => {
    it('detects wrong component type at a pinned slot', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              component('StatsBlock', { stats: [] }), // non-pinned component (allowed)
              component('CTABlock', { label: 'Click' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      // StatsBlock is not pinned, so it's allowed between pinned components
      // The real issue is that BodyBlock is missing
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('BodyBlock');
      expect(errors[0].message).toContain('BodyBlock');
      expect(errors[0].message).toContain('missing');
    });
  });

  describe('pinned_component_out_of_order', () => {
    it('detects when pinned components are out of order', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('BodyBlock', { content: 'Content' }), // should be second
              component('HeroBlock', { title: 'Welcome' }), // should be first
              component('CTABlock', { label: 'Click' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      // HeroBlock is found at index 1, BodyBlock cannot be found after that (it's at index 0)
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('pinned_component_out_of_order');
      expect(errors[0].componentType).toBe('BodyBlock');
    });

    it('allows pinned components in correct relative order with non-pinned components between them', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
              component('StatsBlock', { stats: [] }), // non-pinned, between HeroBlock and CTABlock
              component('CTABlock', { label: 'Click' }),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: productTemplate,
      });

      expect(errors).toHaveLength(0);
    });
  });

  describe('Puck-native snapshot format', () => {
    it('validates components from top-level content array', () => {
      const documentSnapshot = {
        content: [
          component('HeroBlock', { title: 'Welcome' }),
          component('BodyBlock', { content: 'Content here' }),
          component('CTABlock', { label: 'Click me' }),
        ],
        root: { props: { title: 'Page' } },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('detects missing pinned components in Puck-native format', () => {
      const documentSnapshot = {
        content: [
          component('HeroBlock', { title: 'Welcome' }),
        ],
        root: { props: { title: 'Page' } },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(2);
      expect(errors[0].componentType).toBe('BodyBlock');
      expect(errors[1].componentType).toBe('CTABlock');
    });
  });

  describe('edge cases', () => {
    it('handles missing content array gracefully', () => {
      const documentSnapshot = {
        root: {
          props: {},
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(3); // all pinned components missing
      expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
    });

    it('handles malformed document structure gracefully', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: 'not an array',
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(3); // all pinned components missing
    });

    it('returns no errors for template with only non-pinned components', () => {
      const flexibleTemplate = template([
        { type: 'StatsBlock', id: 'stats-1', pinned: false },
        { type: 'TestimonialsBlock', id: 'testimonials-1', pinned: false },
      ]);

      const documentSnapshot = {
        root: {
          props: {
            content: [
              component('HeroBlock', {}),
              component('BodyBlock', {}),
            ],
          },
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: flexibleTemplate,
      });

      expect(errors).toHaveLength(0); // no pinned components to validate
    });
  });

  describe('CRITICAL robustness - crash prevention', () => {
    describe('document null/undefined handling', () => {
      it('handles document with null root without crashing', () => {
        const documentSnapshot = {
          root: null,
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(3); // all pinned components missing
        expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
      });

      it('handles document with undefined root without crashing', () => {
        const documentSnapshot = {
          root: undefined,
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(3); // all pinned components missing
        expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
      });

      it('handles document with array instead of object at root', () => {
        const documentSnapshot = {
          root: [component('HeroBlock')] as unknown,
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(3); // all pinned components missing
        expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
      });

      it('handles document root.props is null', () => {
        const documentSnapshot = {
          root: {
            props: null,
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(3); // all pinned components missing
        expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
      });

      it('handles document root.props is undefined', () => {
        const documentSnapshot = {
          root: {
            props: undefined,
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(3); // all pinned components missing
        expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
      });

      it('handles document root.props is not an array', () => {
        const documentSnapshot = {
          root: {
            props: 'invalid',
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(3); // all pinned components missing
        expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
      });
    });

    describe('component duplication handling', () => {
      it('detects pinned component duplicated in document', () => {
        const documentSnapshot = {
          root: {
            props: {
              content: [
                component('HeroBlock', { title: 'First Hero' }),
                component('BodyBlock', { content: 'Content' }),
                component('HeroBlock', { title: 'Second Hero' }), // duplicate
                component('CTABlock', { label: 'Click' }),
              ],
            },
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        // Should not fail validation - takes first occurrence
        expect(errors).toHaveLength(0);
      });

      it('handles template with duplicate pinned component types', () => {
        const duplicateTemplate = template([
          { type: 'HeroBlock', id: 'hero-1', pinned: true, props: { title: '' } },
          { type: 'BodyBlock', id: 'body-1', pinned: true, props: { content: '' } },
          { type: 'HeroBlock', id: 'hero-2', pinned: true, props: { subtitle: '' } }, // duplicate type
        ]);

        const documentSnapshot = {
          root: {
            props: {
              content: [
                component('HeroBlock', { title: 'Welcome' }),
                component('BodyBlock', { content: 'Content' }),
                component('HeroBlock', { subtitle: 'Subtitle' }),
              ],
            },
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: duplicateTemplate,
        });

        // Should handle gracefully - both HeroBlocks should match
        expect(errors).toHaveLength(0);
      });
    });

    describe('deep nesting handling', () => {
      it('handles deeply nested props without affecting validation', () => {
        const deeplyNestedComponent = {
          type: 'HeroBlock',
          props: {
            id: TEST_UUID,
            level1: {
              level2: {
                level3: {
                  level4: {
                    level5: {
                      level6: {
                        level7: {
                          level8: {
                            level9: {
                              level10: {
                                deepValue: 'nested value',
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };

        const documentSnapshot = {
          root: {
            props: {
              content: [
                deeplyNestedComponent,
                component('BodyBlock', { content: 'Content' }),
                component('CTABlock', { label: 'Click' }),
              ],
            },
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        expect(errors).toHaveLength(0);
      });
    });

    describe('malformed component handling', () => {
      it('handles component without type field gracefully', () => {
        const documentSnapshot = {
          root: {
            props: {
              content: [
                { props: { id: TEST_UUID } }, // missing type field
                component('HeroBlock', { title: 'Welcome' }),
                component('BodyBlock', { content: 'Content' }),
                component('CTABlock', { label: 'Click' }),
              ],
            },
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: blogTemplate,
        });

        // Should not crash, component without type is ignored
        expect(errors).toHaveLength(0);
      });
    });

    describe('template null/undefined handling', () => {
      const conformingDocument = {
        root: {
          props: {
            content: [
              component('HeroBlock', { title: 'Welcome' }),
            ],
          },
        },
      };

      it('handles template content is null', () => {
        const templateSnapshot = {
          content: null,
          root: { props: { _pinMap: {} } },
          zones: {},
        } as unknown as TemplateSnapshot;

        const { errors } = validateDocumentStructure({
          documentSnapshot: conformingDocument,
          templateSnapshot,
        });

        // Should handle gracefully - no components to validate
        expect(errors).toHaveLength(0);
      });

      it('handles template content is undefined', () => {
        const templateSnapshot = {
          root: { props: { _pinMap: {} } },
          zones: {},
        } as unknown as TemplateSnapshot;

        const { errors } = validateDocumentStructure({
          documentSnapshot: conformingDocument,
          templateSnapshot,
        });

        // Should handle gracefully - no components to validate
        expect(errors).toHaveLength(0);
      });

      it('handles template root is null', () => {
        const templateSnapshot = {
          content: [{ type: 'HeroBlock', props: { id: 'hero-1' } }],
          root: null,
          zones: {},
        } as unknown as TemplateSnapshot;

        const { errors } = validateDocumentStructure({
          documentSnapshot: conformingDocument,
          templateSnapshot,
        });

        // No pin map reachable - nothing pinned
        expect(errors).toHaveLength(0);
      });

      it('handles pin map that is not an object', () => {
        const templateSnapshot = {
          content: [{ type: 'HeroBlock', props: { id: 'hero-1' } }],
          root: { props: { _pinMap: 'invalid' } },
          zones: {},
        } as unknown as TemplateSnapshot;

        const { errors } = validateDocumentStructure({
          documentSnapshot: conformingDocument,
          templateSnapshot,
        });

        expect(errors).toHaveLength(0);
      });

      it('handles null template snapshot', () => {
        const { errors } = validateDocumentStructure({
          documentSnapshot: conformingDocument,
          templateSnapshot: null as unknown as TemplateSnapshot,
        });

        expect(errors).toHaveLength(0);
      });
    });
  });
});
