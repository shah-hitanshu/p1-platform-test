import { describe, it, expect } from 'vitest';
import { validateOps } from '../src/index.js';
import type { ComponentSchema, EditOperation } from '../src/index.js';

// ---------------------------------------------------------------------------
// Registry fixtures
// ---------------------------------------------------------------------------

const heroSchema: ComponentSchema = {
  name: 'Hero',
  defaultProps: { title: '', subtitle: '', visible: true, background: 'white' },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'subtitle', type: 'text' },
    { name: 'visible', type: 'checkbox' },
    {
      name: 'background',
      type: 'select',
      options: [
        { label: 'White', value: 'white' },
        { label: 'Light Gray', value: 'light' },
        { label: 'Dark Gray', value: 'dark' },
        { label: 'Black', value: 'black' },
      ],
    },
  ],
};

const featuresSchema: ComponentSchema = {
  name: 'Features',
  defaultProps: { heading: '', items: [] },
  allowedAdditionalProps: ['waterType'],
};

const richTextSchema: ComponentSchema = {
  name: 'RichText',
  defaultProps: { body: '' },
  opaqueProps: ['body'],
};

const columnSchema: ComponentSchema = {
  name: 'Column',
  defaultProps: { title: '' },
};

const registry: Record<string, ComponentSchema> = {
  Hero: heroSchema,
  Features: featuresSchema,
  RichText: richTextSchema,
  Column: columnSchema,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function op(
  type: EditOperation['type'],
  path: string,
  content?: unknown,
): EditOperation {
  return { type, path, content };
}

// Canonical test UUID (v4) — used wherever a valid id is needed in fixtures
const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ULID = '01HWXKQ3BFMNT4XBM4XZT4XBXX';

function component(
  type: string,
  props: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { type, props: { id: TEST_UUID, ...props }, ...extra };
}

// ---------------------------------------------------------------------------
// validateOps — core validation
// ---------------------------------------------------------------------------

describe('validateOps', () => {
  describe('empty registry — graceful degradation', () => {
    it('returns no errors when registry is empty', () => {
      const ops = [op('replace', 'content.0', component('AnythingAtAll', { id: 'x' }))];
      const { errors } = validateOps({ operations: ops, registry: {} });
      expect(errors).toHaveLength(0);
    });
  });

  describe('all-valid operations', () => {
    it('returns no errors for a valid component replace', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', subtitle: 'Sub', visible: false }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(0);
    });

    it('returns no errors for a valid add', () => {
      const ops = [op('add', 'content', component('Hero', { title: 'New' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(0);
    });

    it('skips remove/move/reorder ops (no content to validate)', () => {
      const ops: EditOperation[] = [
        { type: 'remove', path: 'content.0' },
        { type: 'move', path: 'content', fromIndex: 0, toIndex: 1 },
        { type: 'reorder', path: 'content', fromIndex: 1, toIndex: 2 },
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(0);
    });

    it('id prop is always allowed regardless of defaultProps', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', id: TEST_UUID }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(0);
    });

    it('allowedAdditionalProps keys pass validation', () => {
      const ops = [op('replace', 'content.0', component('Features', { heading: 'H', waterType: 'fresh' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(0);
    });
  });

  describe('unknown_component_type', () => {
    it('errors when component type is not in registry', () => {
      const ops = [op('add', 'content.0', component('InventedWidget', { foo: 'bar' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('unknown_component_type');
      expect(errors[0].opIndex).toBe(0);
      expect(errors[0].message).toContain('InventedWidget');
    });

    it('reports all unknown types across multiple ops', () => {
      const ops = [
        op('add', 'content.0', component('Ghost', {})),
        op('add', 'content.1', component('Hero', { title: 'ok' })),
        op('add', 'content.2', component('Phantom', {})),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      const codes = errors.map((e) => e.code);
      expect(codes).toEqual(['unknown_component_type', 'unknown_component_type']);
      expect(errors[0].opIndex).toBe(0);
      expect(errors[1].opIndex).toBe(2);
    });

    it('returns multiple errors in the same op (type unknown + other)', () => {
      const ops = [op('replace', 'content.0', component('Unknown', { badKey: true }))];
      const { errors } = validateOps({ operations: ops, registry });
      // unknown_component_type short-circuits prop validation for that component
      expect(errors.some((e) => e.code === 'unknown_component_type')).toBe(true);
    });

    it('falls back to the registry key when a schema is missing .name (e.g. a hand-built cross-boundary registry)', () => {
      // ComponentSchema.name is required for in-repo callers, but validateOps is a
      // public boundary — simulate a caller-supplied registry entry that omits it.
      const nameless = { defaultProps: {} } as unknown as ComponentSchema;
      const registryWithNamelessEntry: Record<string, ComponentSchema> = {
        ...registry,
        Banner: nameless,
      };
      const ops = [op('add', 'content.0', component('InventedWidget', {}))];
      const { errors } = validateOps({ operations: ops, registry: registryWithNamelessEntry });
      // Keys are normalized (lowercased) before this point, so the fallback
      // surfaces the normalized key rather than the original casing.
      expect(errors[0].message).toContain('banner');
      expect(errors[0].message).not.toContain('undefined');
    });
  });

  describe('invalid_prop_key', () => {
    it('errors on a prop key not in defaultProps', () => {
      const ops = [op('replace', 'content.0', component('Hero', { heading: 'oops' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_key');
      expect(errors[0].message).toContain('heading');
      expect(errors[0].message).toContain('Hero');
    });

    it('errors on multiple invalid prop keys in one component', () => {
      const ops = [op('replace', 'content.0', component('Hero', { badA: 1, badB: 2, title: 'ok' }))];
      const { errors } = validateOps({ operations: ops, registry });
      const propErrors = errors.filter((e) => e.code === 'invalid_prop_key');
      expect(propErrors).toHaveLength(2);
      expect(propErrors.map((e) => e.message).join(' ')).toContain('badA');
      expect(propErrors.map((e) => e.message).join(' ')).toContain('badB');
    });

    it('collects all errors across multiple ops', () => {
      const ops = [
        op('replace', 'content.0', component('Hero', { invented: true })),
        op('replace', 'content.1', component('Features', { invented: true })),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(2);
      expect(errors[0].opIndex).toBe(0);
      expect(errors[1].opIndex).toBe(1);
    });
  });

  describe('invalid_readonly_key — readOnly sibling in component content', () => {
    it('errors when writer sets readOnly sibling on a component', () => {
      const ops = [
        op('replace', 'content.0', {
          ...component('Hero', { title: 'Hi' }),
          readOnly: { title: true },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'invalid_readonly_key')).toBe(true);
    });

    it('errors when op path targets readOnly directly', () => {
      const ops = [op('replace', 'content.0.readOnly', { title: true })];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_readonly_key');
    });

    it('errors when op path traverses through readOnly', () => {
      const ops = [op('replace', 'content.0.readOnly.title', true)];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_readonly_key');
    });
  });

  describe('deprecated_zones_usage', () => {
    it('warns when op path starts with zones', () => {
      const ops = [op('add', 'zones.hero:slot.0', component('Hero', { title: 'Hi' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'deprecated_zones_usage')).toBe(true);
    });

    it('warns when content contains a zones key', () => {
      const ops = [
        op('replace', 'root', {
          content: [],
          root: { props: {} },
          zones: { 'hero:content': [] },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'deprecated_zones_usage')).toBe(true);
    });

    it('does not error on zones when warnOnZonesUsage is false', () => {
      const ops = [op('add', 'zones.hero:slot.0', component('Hero', { title: 'Hi' }))];
      const { errors } = validateOps({
        operations: ops,
        registry,
        config: { warnOnZonesUsage: false },
      });
      expect(errors.every((e) => e.code !== 'deprecated_zones_usage')).toBe(true);
    });
  });

  describe('slot recursion', () => {
    it('validates components nested inside slot props', () => {
      const ops = [
        op('replace', 'content.0', {
          type: 'Column',
          props: {
            id: TEST_UUID,
            title: 'My Column',
            children: [
              component('InventedChild', { foo: 'bar' }),
            ],
          },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'unknown_component_type')).toBe(true);
      expect(errors.some((e) => e.message.includes('InventedChild'))).toBe(true);
    });

    it('validates invalid props on deeply nested slot component', () => {
      const ops = [
        op('replace', 'content.0', {
          type: 'Column',
          props: {
            id: TEST_UUID,
            title: 'My Column',
            children: [
              component('Hero', { title: 'ok', badProp: 'bad' }),
            ],
          },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'invalid_prop_key')).toBe(true);
    });

    it('validates all components in a heterogeneous content array', () => {
      const ops = [
        op('replace', 'content', [
          component('Hero', { title: 'ok' }),
          component('Ghost', {}),
          component('Features', { heading: 'ok', badProp: 'bad' }),
        ]),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      const codes = errors.map((e) => e.code);
      expect(codes).toContain('unknown_component_type');
      expect(codes).toContain('invalid_prop_key');
    });
  });

  describe('opaqueProps', () => {
    it('does not recurse into opaque prop values', () => {
      // body is opaqueProps on RichText — its value is an arbitrary object
      // If we recursed, we'd treat its contents as component shapes and potentially error
      const ops = [
        op('replace', 'content.0', {
          type: 'RichText',
          props: {
            id: TEST_UUID,
            body: {
              // Looks like a component shape — should NOT be validated
              type: 'paragraph',
              props: { invented: true },
            },
          },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(0);
    });
  });

  describe('root component detection', () => {
    it('does not emit unknown_component_type when __root__ is in the registry', () => {
      // Validates that a component explicitly typed as __root__ (e.g., set by a writer
      // that constructs Puck data directly) passes when __root__ is registered.
      const rootRegistry = {
        ...registry,
        __root__: {
          name: '__root__',
          defaultProps: { backgroundColor: '#fff', padding: 0 },
        },
      };
      const ops = [
        op('replace', 'content.0', {
          type: '__root__',
          props: { id: TEST_UUID, backgroundColor: '#000', padding: 16 },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry: rootRegistry });
      expect(errors).toHaveLength(0);
    });

    it('emits unknown_component_type when __root__ is not in the registry', () => {
      // Verifies the registry lookup path for __root__ is not special-cased
      const ops = [
        op('replace', 'content.0', {
          type: '__root__',
          props: { id: TEST_UUID, backgroundColor: '#000' },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('unknown_component_type');
    });
  });

  describe('snapshot-based prop validation (currentSnapshot)', () => {
    // A snapshot containing a Hero at content.0 and Features at content.1
    const snapshot: Record<string, unknown> = {
      content: [
        { type: 'Hero', props: { id: 'h1', title: 'Hello', subtitle: '', visible: true } },
        { type: 'Features', props: { id: 'f1', heading: 'H', items: [], waterType: 'fresh' } },
      ],
      root: { props: {} },
    };

    it('catches invalid prop key on a targeted primitive replace', () => {
      // The exact bug: content.2.props.background = "steve" passes without snapshot
      // but must be caught when the snapshot reveals the component type
      const ops = [op('replace', 'content.0.props.invented', 'some value')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_key');
      expect(errors[0].message).toContain('invented');
      expect(errors[0].message).toContain('Hero');
    });

    it('allows a valid prop key on a targeted primitive replace', () => {
      const ops = [op('replace', 'content.0.props.title', 'New Title')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(0);
    });

    it('allows allowedAdditionalProps keys via snapshot resolution', () => {
      const ops = [op('replace', 'content.1.props.waterType', 'salt')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(0);
    });

    it('does not error when snapshot is absent (graceful degradation)', () => {
      const ops = [op('replace', 'content.0.props.invented', 'some value')];
      const { errors } = validateOps({ operations: ops, registry }); // no currentSnapshot
      expect(errors).toHaveLength(0);
    });

    it('does not error when snapshot path resolves to a non-component', () => {
      const ops = [op('replace', 'root.props.nonExistent', 'value')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(0); // root has no type — not a component shape
    });

    it('catches invalid prop key when replacing the entire props object (path ends at .props)', () => {
      const ops = [op('replace', 'content.0.props', { id: TEST_UUID, invented: 'bad', title: 'ok' })];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors.some((e) => e.code === 'invalid_prop_key' && e.message.includes('invented'))).toBe(true);
    });

    it('passes when replacing the entire props object with all valid keys', () => {
      const ops = [op('replace', 'content.0.props', { id: TEST_UUID, title: 'ok', subtitle: 'ok', visible: true })];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(0);
    });

    it('catches missing id when replacing the entire props object', () => {
      const ops = [op('replace', 'content.0.props', { title: 'ok' })]; // no id
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors.some((e) => e.code === 'missing_required_prop')).toBe(true);
    });

    it('does not double-report errors already caught by content validation', () => {
      // Replacing a whole component still works without snapshot interference
      const ops = [
        op('replace', 'content.0', component('Hero', { title: 'ok', badProp: 'bad' })),
      ];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      const propErrors = errors.filter((e) => e.code === 'invalid_prop_key');
      expect(propErrors).toHaveLength(1); // only one error for badProp, not doubled
    });
  });

  describe('fields[] without defaultProps entry', () => {
    it('allows a prop that is declared in fields but not in defaultProps', () => {
      // SectionHeaderBlock regression: subtitle is in fields but not defaultProps.
      // The validator must treat fields[] as the authoritative allowed-key list.
      const schemaWithOptionalField: ComponentSchema = {
        name: 'SectionHeaderBlock',
        defaultProps: { title: 'Section Title', background: 'dark' },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'background', type: 'select', options: [{ label: 'Dark', value: 'dark' }] },
          { name: 'subtitle', type: 'text' }, // no default value
        ],
      };
      const reg = { SectionHeaderBlock: schemaWithOptionalField };
      const ops = [
        op('replace', 'content.0', {
          type: 'SectionHeaderBlock',
          props: { id: TEST_UUID, title: 'My Section', subtitle: 'A one-line elaboration', background: 'dark' },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(0);
    });
  });

  describe('id format validation', () => {
    it('accepts a bare UUID v4 as id', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', id: '550e8400-e29b-41d4-a716-446655440000' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.filter((e) => e.code === 'invalid_prop_value' && e.path.includes('.id'))).toHaveLength(0);
    });

    it('accepts a type-prefixed UUID v4 as id (Puck native format)', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', id: 'Hero-550e8400-e29b-41d4-a716-446655440000' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.filter((e) => e.code === 'invalid_prop_value' && e.path.includes('.id'))).toHaveLength(0);
    });

    it('accepts a ULID as id', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', id: TEST_ULID }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.filter((e) => e.code === 'invalid_prop_value' && e.path.includes('.id'))).toHaveLength(0);
    });

    it('rejects an arbitrary string as id', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', id: 'roger' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'invalid_prop_value' && e.message.includes('roger'))).toBe(true);
    });

    it('rejects a targeted id write with arbitrary string', () => {
      const snapshot: Record<string, unknown> = {
        content: [{ type: 'Hero', props: { id: TEST_UUID, title: 'Hi' } }],
      };
      const ops = [op('replace', 'content.0.props.id', 'steve')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_value');
      expect(errors[0].message).toContain('steve');
    });
  });

  describe('missing_required_prop — id presence', () => {
    it('errors when a component has no id in props', () => {
      const ops = [op('replace', 'content.0', { type: 'Hero', props: { title: 'Hi' } })];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('missing_required_prop');
      expect(errors[0].message).toContain('id');
    });

    it('passes when the component has an id in props', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.filter((e) => e.code === 'missing_required_prop')).toHaveLength(0);
    });

    it('checks id on components nested in slot props', () => {
      const ops = [
        op('replace', 'content.0', {
          type: 'Column',
          props: {
            id: TEST_UUID,
            title: 'My Column',
            children: [
              { type: 'Hero', props: { title: 'no id here' } }, // missing id
            ],
          },
        }),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'missing_required_prop')).toBe(true);
    });
  });

  describe('enum value validation (invalid_prop_value)', () => {
    it('catches an invalid select value on a full component replace', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', background: 'roger' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_value');
      expect(errors[0].message).toContain('roger');
      expect(errors[0].message).toContain('background');
      expect(errors[0].message).toContain('"white"');
    });

    it('allows valid select values on a full component replace', () => {
      for (const value of ['white', 'light', 'dark', 'black']) {
        const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', background: value }))];
        const { errors } = validateOps({ operations: ops, registry });
        expect(errors.filter((e) => e.code === 'invalid_prop_value')).toHaveLength(0);
      }
    });

    it('catches an invalid select value on a targeted prop write (with snapshot)', () => {
      const snapshot: Record<string, unknown> = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Hi', background: 'white' } },
        ],
      };
      const ops = [op('replace', 'content.0.props.background', 'roger')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_value');
      expect(errors[0].message).toContain('roger');
    });

    it('allows valid select value on a targeted prop write (with snapshot)', () => {
      const snapshot: Record<string, unknown> = {
        content: [
          { type: 'Hero', props: { id: 'h1', title: 'Hi', background: 'white' } },
        ],
      };
      const ops = [op('replace', 'content.0.props.background', 'dark')];
      const { errors } = validateOps({ operations: ops, registry, currentSnapshot: snapshot });
      expect(errors).toHaveLength(0);
    });

    it('does not validate value for non-select field types', () => {
      // title is type:text — any string is allowed
      const ops = [op('replace', 'content.0', component('Hero', { title: 'anything at all' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.filter((e) => e.code === 'invalid_prop_value')).toHaveLength(0);
    });

    it('does not validate value when field has no options array', () => {
      const schemaNoOptions: ComponentSchema = {
        name: 'Widget',
        defaultProps: { theme: 'default' },
        fields: [{ name: 'theme', type: 'select' }], // select with no options
      };
      const reg = { Widget: schemaNoOptions };
      const ops = [op('replace', 'content.0', component('Widget', { theme: 'anything' }))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(0);
    });

    it('catches an invalid numeric value on a select with number options', () => {
      // Regression: columns:6 bypassed validation because typeof 6 !== 'string'
      const numericSchema: ComponentSchema = {
        name: 'StatsBlock',
        defaultProps: { columns: 3 },
        fields: [
          {
            name: 'columns',
            type: 'select',
            options: [
              { label: '2 Columns', value: 2 },
              { label: '3 Columns', value: 3 },
              { label: '4 Columns', value: 4 },
            ],
          },
        ],
      };
      const reg = { StatsBlock: numericSchema };
      const ops = [op('replace', 'content.0', { type: 'StatsBlock', props: { id: TEST_UUID, columns: 6 } })];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_value');
      expect(errors[0].message).toContain('6');
      expect(errors[0].message).toContain('2');
    });

    it('allows valid numeric values on a select with number options', () => {
      const numericSchema: ComponentSchema = {
        name: 'StatsBlock',
        defaultProps: { columns: 3 },
        fields: [{ name: 'columns', type: 'select', options: [{ label: '3', value: 3 }, { label: '4', value: 4 }] }],
      };
      const reg = { StatsBlock: numericSchema };
      const ops = [op('replace', 'content.0', { type: 'StatsBlock', props: { id: TEST_UUID, columns: 3 } })];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(0);
    });

    it('catches an invalid boolean value on a radio with boolean options', () => {
      const boolSchema: ComponentSchema = {
        name: 'Widget',
        defaultProps: { showDividers: true },
        fields: [
          { name: 'showDividers', type: 'radio', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
        ],
      };
      const reg = { Widget: boolSchema };
      const ops = [op('replace', 'content.0', { type: 'Widget', props: { id: TEST_UUID, showDividers: 'yes' } })];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('invalid_prop_value');
    });

    it('reports invalid_prop_key before skipping invalid_prop_value for unknown key', () => {
      const ops = [op('replace', 'content.0', component('Hero', { title: 'Hi', unknownKey: 'bad' }))];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.some((e) => e.code === 'invalid_prop_key')).toBe(true);
      // No invalid_prop_value for the unknown key (key rejected first)
      const valueErrors = errors.filter((e) => e.code === 'invalid_prop_value' && e.message.includes('unknownKey'));
      expect(valueErrors).toHaveLength(0);
    });
  });

  describe('op index accuracy', () => {
    it('assigns correct opIndex to each error', () => {
      const ops: EditOperation[] = [
        op('add', 'content.0', component('Hero', { title: 'ok' })),
        { type: 'remove', path: 'content.1' },
        op('replace', 'content.2', component('Ghost', {})),
        op('replace', 'content.3', component('Features', { badKey: true })),
      ];
      const { errors } = validateOps({ operations: ops, registry });
      expect(errors.find((e) => e.code === 'unknown_component_type')?.opIndex).toBe(2);
      expect(errors.find((e) => e.code === 'invalid_prop_key')?.opIndex).toBe(3);
    });
  });

  // Registry casing regression (PCC-3437 follow-up): registry document paths
  // are lowercased server-side, but a component's real name (e.g.
  // "LeadCapture") is preserved in the descriptor snapshot. Lookups must be
  // case-insensitive regardless of which casing the registry keys or the
  // component's `type` happen to use.
  describe('case-insensitive registry lookup', () => {
    const leadCaptureSchema: ComponentSchema = {
      name: 'LeadCapture',
      defaultProps: { headline: '' },
      fields: [{ name: 'headline', type: 'text' }],
    };

    it('matches a PascalCase component type against a lowercase-keyed registry entry', () => {
      // Mirrors what a path-derived registry key looks like post-normalizePath.
      const reg = { leadcapture: leadCaptureSchema };
      const ops = [op('add', 'content.0', component('LeadCapture', { headline: 'Sign up' }))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(0);
    });

    // This assertion is inverted from what it was (PCC-3561). It used to expect
    // a lowercase type to pass, which is how the bug shipped: the lookup found
    // LeadCapture's schema, every prop validated against it, and "leadcapture"
    // was written to the document — where Puck's exact-key lookup could not
    // resolve it. Matching case-insensitively is still required (paths are
    // lowercased server-side); writing the caller's casing through is not.
    it('rejects a lowercase component type even though the lookup resolves it', () => {
      const reg = { LeadCapture: leadCaptureSchema };
      const ops = [op('add', 'content.0', component('leadcapture', { headline: 'Sign up' }))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('component_type_case_mismatch');
      expect(errors[0].message).toContain('LeadCapture');
    });

    it('names the expected casing so the fix is mechanical', () => {
      const reg = { leadcapture: leadCaptureSchema };
      const ops = [op('add', 'content.0', component('LEADCAPTURE', { headline: 'Sign up' }))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors[0].code).toBe('component_type_case_mismatch');
      expect(errors[0].message).toContain('use "LeadCapture"');
    });

    it('does not report prop errors alongside a case mismatch', () => {
      const reg = { leadcapture: leadCaptureSchema };
      const ops = [op('add', 'content.0', component('leadcapture', { nope: true }))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors.map((e) => e.code)).toEqual(['component_type_case_mismatch']);
    });

    it('accepts the exact registered casing', () => {
      const reg = { leadcapture: leadCaptureSchema };
      const ops = [op('add', 'content.0', component('LeadCapture', { headline: 'Sign up' }))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(0);
    });

    it('holds nested slot content to the same rule', () => {
      const reg = { leadcapture: leadCaptureSchema, features: featuresSchema };
      const ops = [
        op('add', 'content.0', component('Features', {
          items: [component('leadcapture', { headline: 'Nested' })],
        })),
      ];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors.map((e) => e.code)).toEqual(['component_type_case_mismatch']);
      expect(errors[0].path).toBe('content.0.props.items.0');
    });

    it('skips the casing check when a caller-supplied schema omits .name', () => {
      const nameless = { defaultProps: { headline: '' } } as unknown as ComponentSchema;
      const ops = [op('add', 'content.0', component('leadcapture', { headline: 'x' }))];
      const { errors } = validateOps({
        operations: ops,
        registry: { leadcapture: nameless },
      });
      expect(errors).toHaveLength(0);
    });

    it('still reports unknown_component_type for a genuinely unregistered type', () => {
      const reg = { leadcapture: leadCaptureSchema };
      const ops = [op('add', 'content.0', component('TotallyMadeUp', {}))];
      const { errors } = validateOps({ operations: ops, registry: reg });
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('unknown_component_type');
      // Error message surfaces the registry's real display name, not the raw key.
      expect(errors[0].message).toContain('LeadCapture');
    });

    it('resolves a case-mismatched type on a targeted prop-path write (validatePropPathOp)', () => {
      const reg = { leadcapture: leadCaptureSchema };
      const currentSnapshot = {
        content: [component('LeadCapture', { headline: 'Old' })],
      };
      const ops = [op('replace', 'content.0.props.headline', 'New headline')];
      const { errors } = validateOps({ operations: ops, registry: reg, currentSnapshot });
      expect(errors).toHaveLength(0);
    });
  });
});
