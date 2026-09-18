/**
 * A proposal's dot-path operations become document-session edits. What matters is
 * that each kind lands where the proposal pointed, and that a move the session
 * cannot express is refused rather than half-applied.
 */

import { describe, expect, it } from 'vitest';
import { ThreadInputError } from '../../../src/services/threads/errors';
import { toEditOperations } from '../../../src/routes/threads/proposal-edits';

describe('toEditOperations', () => {
  it('replaces a field with the proposed value', () => {
    expect(toEditOperations([{ op: 'replace', path: 'content.0.props.title', value: 'Hello' }])).toEqual([
      { type: 'replace', path: 'content.0.props.title', content: 'Hello' },
    ]);
  });

  it('inserts into a list at the position named, and sets a field otherwise', () => {
    expect(
      toEditOperations([
        { op: 'add', path: 'content.2', value: { type: 'Text', props: {} } },
        { op: 'add', path: 'content.0.props.subtitle', value: 'Under' },
      ]),
    ).toEqual([
      { type: 'insert', path: 'content', index: 2, value: { type: 'Text', props: {} } },
      { type: 'set', path: 'content.0.props.subtitle', value: 'Under' },
    ]);
  });

  it('removes what the path names', () => {
    expect(toEditOperations([{ op: 'remove', path: 'content.1' }])).toEqual([{ type: 'delete', path: 'content.1' }]);
  });

  it('moves within one list by index', () => {
    expect(toEditOperations([{ op: 'move', from: 'content.3', path: 'content.0' }])).toEqual([
      { type: 'move', path: 'content', fromIndex: 3, toIndex: 0 },
    ]);
  });

  it('refuses a move across lists or without a source', () => {
    expect(() => toEditOperations([{ op: 'move', from: 'content.3', path: 'zones.aside.0' }])).toThrow(
      ThreadInputError,
    );
    expect(() => toEditOperations([{ op: 'move', path: 'content.0' }])).toThrow(ThreadInputError);
  });
});
