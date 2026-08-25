import { describe, it, expect } from 'vitest';
import {
  findComponentTypeViolations,
  componentTypeKey,
} from '../../src/services/component-type-validation';

/**
 * PCC-3561: the backend's own component-type check. The MCP servers validate
 * too, but that check is skippable and duplicated, so it cannot be the
 * guarantee — these cases are about what reaches a document when the client-side
 * check does not run.
 */

function canonical(...names: string[]): Map<string, string> {
  return new Map(names.map((n) => [componentTypeKey(n), n]));
}

const ID = '550e8400-e29b-41d4-a716-446655440000';
const registered = canonical('QuoteBlock', 'GridBlock');

function comp(type: string, props: Record<string, unknown> = {}) {
  return { type, props: { id: ID, ...props } };
}

describe('findComponentTypeViolations', () => {
  it('accepts the registered casing', () => {
    const ops = [{ type: 'replace', path: 'content.0', value: comp('QuoteBlock') }];
    expect(findComponentTypeViolations(ops, registered)).toEqual([]);
  });

  it('rejects a lowercase type — the PCC-3561 repro', () => {
    const ops = [{ type: 'replace', path: 'content.0', value: comp('quoteblock') }];
    const violations = findComponentTypeViolations(ops, registered);
    expect(violations.map((v) => v.code)).toEqual(['component_type_case_mismatch']);
    expect(violations.map((v) => v.message).join('')).toContain('use "QuoteBlock"');
  });

  it('rejects an unregistered type', () => {
    const ops = [{ type: 'replace', path: 'content.0', value: comp('MadeUpBlock') }];
    const violations = findComponentTypeViolations(ops, registered);
    expect(violations.map((v) => v.code)).toEqual(['unknown_component_type']);
  });

  // The ticket's agent could not use `add`, so it replaced the whole content
  // array — the bad component arrived buried in a list of good ones.
  it('finds a bad type inside a whole-array replace', () => {
    const ops = [{
      type: 'replace',
      path: 'content',
      value: [comp('QuoteBlock'), comp('GridBlock'), comp('quoteblock')],
    }];
    const violations = findComponentTypeViolations(ops, registered);
    expect(violations.map((v) => v.path)).toEqual(['content.2']);
  });

  it('finds a bad type nested in slot props', () => {
    const ops = [{
      type: 'replace',
      path: 'content.0',
      value: comp('GridBlock', { items: [comp('quoteblock')] }),
    }];
    const violations = findComponentTypeViolations(ops, registered);
    expect(violations.map((v) => v.type)).toEqual(['quoteblock']);
  });

  it('reads the agent-facing `content` field as well as the backend `value` field', () => {
    const ops = [{ type: 'replace', path: 'content.0', content: comp('quoteblock') }];
    expect(findComponentTypeViolations(ops, registered)).toHaveLength(1);
  });

  it('reports every violation across a batch, with op indexes', () => {
    const ops = [
      { type: 'replace', path: 'content.0', value: comp('QuoteBlock') },
      { type: 'replace', path: 'content.1', value: comp('gridblock') },
      { type: 'replace', path: 'content.2', value: comp('Nope') },
    ];
    const violations = findComponentTypeViolations(ops, registered);
    expect(violations.map((v) => v.opIndex)).toEqual([1, 2]);
  });

  it('ignores ops that carry no value', () => {
    const ops = [{ type: 'delete', path: 'content.0' }, { type: 'move', path: 'content' }];
    expect(findComponentTypeViolations(ops, registered)).toEqual([]);
  });

  it('ignores non-component objects that happen to have a type field', () => {
    const ops = [{ type: 'set', path: 'root.props.field', value: { type: 'text', name: 'x' } }];
    expect(findComponentTypeViolations(ops, registered)).toEqual([]);
  });

  // A site whose editor has never opened has no registry to check against.
  // Failing closed would block every agent write to a brand-new site.
  it('skips validation entirely when no components are registered', () => {
    const ops = [{ type: 'replace', path: 'content.0', value: comp('anythinggoes') }];
    expect(findComponentTypeViolations(ops, new Map())).toEqual([]);
  });
});
