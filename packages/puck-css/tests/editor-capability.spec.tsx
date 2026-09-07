/**
 * A capability slot lets one part of the editor carry out what another asks
 * for, without either holding a reference to the other.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useEditorCapability } from '../src/editor/useEditorCapability.js';
import type { EditorCapability } from '../src/editor/useEditorCapability.js';

afterEach(cleanup);

/** Hands the slot back so a test can drive both sides of it. */
function harness<A extends unknown[]>(): { current: EditorCapability<A> | null } {
  const ref: { current: EditorCapability<A> | null } = { current: null };
  function Host(): null {
    ref.current = useEditorCapability<A>();
    return null;
  }
  render(<Host />);
  return ref;
}

describe('useEditorCapability', () => {
  it('passes a call through to the registered implementation', () => {
    const slot = harness<[string]>();
    const implementation = vi.fn();

    act(() => {
      slot.current?.register(implementation);
    });
    slot.current?.call('pricing.fr-FR');

    expect(implementation).toHaveBeenCalledWith('pricing.fr-FR');
  });

  it('does nothing when nothing has registered', () => {
    const slot = harness<[string]>();

    expect(() => slot.current?.call('pricing')).not.toThrow();
  });

  it('keeps call and register stable across renders', () => {
    const seen: unknown[] = [];
    function Host(): null {
      const slot = useEditorCapability<[string]>();
      seen.push(slot.call, slot.register);
      return null;
    }
    const { rerender } = render(<Host />);
    rerender(<Host />);

    expect(seen[0]).toBe(seen[2]);
    expect(seen[1]).toBe(seen[3]);
  });

  it('hands the slot to the latest registration', () => {
    const slot = harness<[string]>();
    const first = vi.fn();
    const second = vi.fn();

    slot.current?.register(first);
    slot.current?.register(second);
    slot.current?.call('pricing');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('pricing');
  });

  it('empties the slot when the registration is withdrawn', () => {
    const slot = harness<[string]>();
    const implementation = vi.fn();

    const withdraw = slot.current?.register(implementation);
    withdraw?.();
    slot.current?.call('pricing');

    expect(implementation).not.toHaveBeenCalled();
  });

  it('leaves a later registration in place when an earlier one is withdrawn', () => {
    const slot = harness<[string]>();
    const first = vi.fn();
    const second = vi.fn();

    const withdrawFirst = slot.current?.register(first);
    slot.current?.register(second);
    withdrawFirst?.();
    slot.current?.call('pricing');

    expect(second).toHaveBeenCalledWith('pricing');
  });
});
