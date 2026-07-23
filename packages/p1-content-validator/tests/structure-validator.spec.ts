import { describe, it, expect, vi } from 'vitest';
import { validateDocumentStructure } from '../src/index.js';
import type { TemplateSnapshot } from '../src/index.js';

/**
 * Structural conformance by slot-id membership.
 *
 * A template component is pinned when `root.props._pinMap[props.id]` is
 * `true`. A document conforms when every pinned slot id is present among its
 * component ids, and the pinned slots found in a list keep the template's
 * relative order within that list. Matching is by id, so a same-typed local
 * component never satisfies a pinned slot, and duplicating a component type
 * cannot mask a missing one. Error codes are `missing_pinned_component` and
 * `pinned_component_out_of_order`.
 */

function comp(
  type: string,
  id: string,
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type, props: { id, ...props } };
}

const blogTemplate: TemplateSnapshot = {
  content: [
    { type: 'HeroBlock', props: { id: 'HeroBlock-slot-1', title: '' } },
    { type: 'BodyBlock', props: { id: 'BodyBlock-slot-1', content: '' } },
    { type: 'CTABlock', props: { id: 'CTABlock-slot-1', label: '' } },
  ],
  root: {
    props: {
      _pinMap: {
        'HeroBlock-slot-1': true,
        'BodyBlock-slot-1': true,
        'CTABlock-slot-1': true,
      },
    },
  },
  zones: {},
};

const productTemplate: TemplateSnapshot = {
  content: [
    { type: 'HeroBlock', props: { id: 'HeroBlock-slot-1', title: '' } },
    { type: 'FeaturesBlock', props: { id: 'FeaturesBlock-slot-1', items: [] } },
    { type: 'CTABlock', props: { id: 'CTABlock-slot-1', label: '' } },
  ],
  root: {
    props: {
      _pinMap: { 'HeroBlock-slot-1': true, 'CTABlock-slot-1': true },
    },
  },
  zones: {},
};

const zonedTemplate: TemplateSnapshot = {
  content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-slot-1', title: '' } }],
  root: {
    props: {
      _pinMap: {
        'HeroBlock-slot-1': true,
        'CtaBlock-slot-1': true,
        'CtaBlock-slot-2': true,
      },
    },
  },
  zones: {
    'HeroBlock-slot-1:cta': [
      { type: 'CtaBlock', props: { id: 'CtaBlock-slot-1', label: '' } },
      { type: 'CtaBlock', props: { id: 'CtaBlock-slot-2', label: '' } },
    ],
  },
};

describe('validateDocumentStructure', () => {
  describe('conformance', () => {
    it('returns no errors when every pinned slot id is present in order', () => {
      const documentSnapshot = {
        content: [
          comp('HeroBlock', 'HeroBlock-slot-1', { title: 'Welcome' }),
          comp('BodyBlock', 'BodyBlock-slot-1', { content: 'Body' }),
          comp('CTABlock', 'CTABlock-slot-1', { label: 'Go' }),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('allows local components between and around pinned slots', () => {
      const documentSnapshot = {
        content: [
          comp('BannerBlock', 'BannerBlock-local-1'),
          comp('HeroBlock', 'HeroBlock-slot-1'),
          comp('QuoteBlock', 'QuoteBlock-local-1'),
          comp('BodyBlock', 'BodyBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
          comp('FooterBlock', 'FooterBlock-local-1'),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('does not require unpinned slots to be present', () => {
      const documentSnapshot = {
        content: [
          comp('HeroBlock', 'HeroBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: productTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('conforms when the template pins nothing', () => {
      const template: TemplateSnapshot = {
        content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-slot-1' } }],
        root: { props: { _pinMap: {} } },
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot: { content: [], zones: {} },
        templateSnapshot: template,
      });

      expect(errors).toHaveLength(0);
    });

    it('conforms when the template has no pin map', () => {
      const template = {
        content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-slot-1' } }],
        root: { props: {} },
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot: { content: [], zones: {} },
        templateSnapshot: template,
      });

      expect(errors).toHaveLength(0);
    });

    it('reads document content nested under root.props.content', () => {
      const documentSnapshot = {
        root: {
          props: {
            content: [
              comp('HeroBlock', 'HeroBlock-slot-1'),
              comp('BodyBlock', 'BodyBlock-slot-1'),
              comp('CTABlock', 'CTABlock-slot-1'),
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

  describe('membership by slot id', () => {
    it('reports a missing pinned slot even when a same-typed local component exists', () => {
      const documentSnapshot = {
        content: [
          comp('HeroBlock', 'HeroBlock-local-1', { title: 'Impostor' }),
          comp('BodyBlock', 'BodyBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('HeroBlock');
      expect(errors[0].message).toContain('HeroBlock');
    });

    it('reports every missing pinned slot', () => {
      const documentSnapshot = {
        content: [comp('BodyBlock', 'BodyBlock-slot-1')],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(2);
      expect(errors.every((e) => e.code === 'missing_pinned_component')).toBe(true);
    });

    it('accepts a duplicated pinned type as long as the slot id is present', () => {
      const documentSnapshot = {
        content: [
          comp('HeroBlock', 'HeroBlock-slot-1'),
          comp('HeroBlock', 'HeroBlock-local-1'),
          comp('BodyBlock', 'BodyBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('satisfies presence with a pinned slot that moved into a zone', () => {
      const documentSnapshot = {
        content: [
          comp('HeroBlock', 'HeroBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {
          'HeroBlock-slot-1:aside': [comp('BodyBlock', 'BodyBlock-slot-1')],
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('ignores template components without a string id when pinning', () => {
      const template = {
        content: [
          { type: 'HeroBlock', props: { title: '' } },
          { type: 'BodyBlock', props: { id: 'BodyBlock-slot-1' } },
        ],
        root: { props: { _pinMap: { 'BodyBlock-slot-1': true } } },
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot: {
          content: [comp('BodyBlock', 'BodyBlock-slot-1')],
          zones: {},
        },
        templateSnapshot: template,
      });

      expect(errors).toHaveLength(0);
    });
  });

  describe('pinned order', () => {
    it('reports a pinned slot that appears before its template predecessor', () => {
      const documentSnapshot = {
        content: [
          comp('BodyBlock', 'BodyBlock-slot-1'),
          comp('HeroBlock', 'HeroBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('pinned_component_out_of_order');
      expect(errors[0].componentType).toBe('BodyBlock');
      expect(errors[0].expectedIndex).toBe(1);
      expect(errors[0].actualIndex).toBe(0);
      expect(errors[0].message).toContain('found at index 0');
    });

    it('does not let local components affect pinned order', () => {
      const documentSnapshot = {
        content: [
          comp('CTABlock', 'CTABlock-local-1'),
          comp('HeroBlock', 'HeroBlock-slot-1'),
          comp('BodyBlock', 'BodyBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('checks order within a zone against the template zone order', () => {
      const documentSnapshot = {
        content: [comp('HeroBlock', 'HeroBlock-slot-1')],
        zones: {
          'HeroBlock-slot-1:cta': [
            comp('CtaBlock', 'CtaBlock-slot-2'),
            comp('CtaBlock', 'CtaBlock-slot-1'),
          ],
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: zonedTemplate,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('pinned_component_out_of_order');
    });

    it('conforms when zone slots keep their template order', () => {
      const documentSnapshot = {
        content: [comp('HeroBlock', 'HeroBlock-slot-1')],
        zones: {
          'HeroBlock-slot-1:cta': [
            comp('CtaBlock', 'CtaBlock-slot-1'),
            comp('CtaBlock', 'CtaBlock-slot-2'),
          ],
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: zonedTemplate,
      });

      expect(errors).toHaveLength(0);
    });

    it('does not report order for a pinned slot that changed lists', () => {
      const documentSnapshot = {
        content: [
          comp('BodyBlock', 'BodyBlock-slot-1'),
          comp('CTABlock', 'CTABlock-slot-1'),
        ],
        zones: {
          'BodyBlock-slot-1:aside': [comp('HeroBlock', 'HeroBlock-slot-1')],
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: blogTemplate,
      });

      expect(errors).toHaveLength(0);
    });
  });

  describe('pinned slots in template zones', () => {
    it('reports a missing pinned zone slot', () => {
      const documentSnapshot = {
        content: [comp('HeroBlock', 'HeroBlock-slot-1')],
        zones: {
          'HeroBlock-slot-1:cta': [comp('CtaBlock', 'CtaBlock-slot-1')],
        },
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot,
        templateSnapshot: zonedTemplate,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_pinned_component');
      expect(errors[0].componentType).toBe('CtaBlock');
    });
  });

  describe('robustness', () => {
    it('never crashes on malformed documents', () => {
      const cases: unknown[] = [
        null,
        undefined,
        {},
        { content: 'not-an-array' },
        { root: null },
        { root: [] },
        { root: { props: null } },
        { content: [null, 42, { props: {} }, { type: 7, props: { id: 'x' } }] },
        { content: [], zones: 'not-an-object' },
        { content: [], zones: { list: 'not-an-array' } },
      ];

      for (const documentSnapshot of cases) {
        expect(() =>
          validateDocumentStructure({
            documentSnapshot: documentSnapshot as Record<string, unknown>,
            templateSnapshot: blogTemplate,
          }),
        ).not.toThrow();
      }
    });

    it('treats malformed templates as pinning nothing', () => {
      const cases: unknown[] = [
        null,
        undefined,
        {},
        { components: [{ type: 'HeroBlock', pinned: true, defaultProps: {} }] },
        { content: 'not-an-array' },
        { content: [], root: null },
        { content: [], root: { props: { _pinMap: null } } },
        { content: [], root: { props: { _pinMap: ['HeroBlock-slot-1'] } } },
      ];

      for (const templateSnapshot of cases) {
        const { errors } = validateDocumentStructure({
          documentSnapshot: { content: [], zones: {} },
          templateSnapshot,
        });
        expect(errors).toHaveLength(0);
      }
    });

    it('ignores a pin map entry with no matching template component', () => {
      const template = {
        content: [{ type: 'HeroBlock', props: { id: 'HeroBlock-slot-1' } }],
        root: {
          props: {
            _pinMap: { 'HeroBlock-slot-1': true, 'GhostBlock-slot-9': true },
          },
        },
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot: {
          content: [comp('HeroBlock', 'HeroBlock-slot-1')],
          zones: {},
        },
        templateSnapshot: template,
      });

      expect(errors).toHaveLength(0);
    });

    it('warns when the template is not content-shaped so a broken deployment is observable', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const { errors } = validateDocumentStructure({
        documentSnapshot: { content: [comp('HeroBlock', 'HeroBlock-slot-1')], zones: {} },
        templateSnapshot: { components: [{ type: 'HeroBlock', pinned: true }] },
      });

      expect(errors).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockRestore();
    });

    it('treats only strict true pin entries as pinned', () => {
      const template = {
        content: [
          { type: 'HeroBlock', props: { id: 'HeroBlock-slot-1' } },
          { type: 'BodyBlock', props: { id: 'BodyBlock-slot-1' } },
        ],
        root: {
          props: {
            _pinMap: { 'HeroBlock-slot-1': false, 'BodyBlock-slot-1': 'yes' },
          },
        },
        zones: {},
      };

      const { errors } = validateDocumentStructure({
        documentSnapshot: { content: [], zones: {} },
        templateSnapshot: template,
      });

      expect(errors).toHaveLength(0);
    });
  });
});
