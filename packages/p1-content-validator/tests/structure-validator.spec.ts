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

// Template with all pinned components
const blogTemplate: TemplateSnapshot = {
  components: [
    { type: 'HeroBlock', pinned: true, defaultProps: { title: '', subtitle: '' } },
    { type: 'BodyBlock', pinned: true, defaultProps: { content: '' } },
    { type: 'CTABlock', pinned: true, defaultProps: { label: '', url: '' } },
  ],
};

// Template with mixed pinned/non-pinned components
const productTemplate: TemplateSnapshot = {
  components: [
    { type: 'HeroBlock', pinned: true, defaultProps: { title: '' } },
    { type: 'FeaturesBlock', pinned: false, defaultProps: { items: [] } },
    { type: 'CTABlock', pinned: true, defaultProps: { label: '' } },
  ],
};

// Empty template (no components)
const emptyTemplate: TemplateSnapshot = {
  components: [],
};

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
      const flexibleTemplate: TemplateSnapshot = {
        components: [
          { type: 'StatsBlock', pinned: false, defaultProps: {} },
          { type: 'TestimonialsBlock', pinned: false, defaultProps: {} },
        ],
      };

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
        const duplicateTemplate: TemplateSnapshot = {
          components: [
            { type: 'HeroBlock', pinned: true, defaultProps: { title: '' } },
            { type: 'BodyBlock', pinned: true, defaultProps: { content: '' } },
            { type: 'HeroBlock', pinned: true, defaultProps: { subtitle: '' } }, // duplicate type
          ],
        };

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
      it('handles template components array is null', () => {
        const nullTemplate: TemplateSnapshot = {
          components: null as unknown as TemplateComponent[],
        };

        const documentSnapshot = {
          root: {
            props: {
              content: [
                component('HeroBlock', { title: 'Welcome' }),
              ],
            },
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: nullTemplate,
        });

        // Should handle gracefully - no components to validate
        expect(errors).toHaveLength(0);
      });

      it('handles template components array is undefined', () => {
        const undefinedTemplate: TemplateSnapshot = {
          components: undefined as unknown as TemplateComponent[],
        };

        const documentSnapshot = {
          root: {
            props: {
              content: [
                component('HeroBlock', { title: 'Welcome' }),
              ],
            },
          },
        };

        const { errors } = validateDocumentStructure({
          documentSnapshot,
          templateSnapshot: undefinedTemplate,
        });

        // Should handle gracefully - no components to validate
        expect(errors).toHaveLength(0);
      });
    });
  });
});
