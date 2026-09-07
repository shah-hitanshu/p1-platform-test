import { useMemo, useRef } from 'react';

/**
 * A capability the editor offers its features but implements somewhere lower
 * down: the app's router owns navigation, the header owns the create-page
 * modal. The provider holds the slot, so a feature calls the capability
 * without knowing which component carries it out.
 *
 * `call` and `register` keep their identity for the provider's lifetime, so a
 * caller can hold either in a dependency array. Calling an unfilled slot does
 * nothing.
 */
export interface EditorCapability<A extends unknown[]> {
  call: (...args: A) => void;
  /** Fills the slot until the returned function runs. */
  register: (implementation: (...args: A) => void) => () => void;
}

export function useEditorCapability<A extends unknown[]>(): EditorCapability<A> {
  const implementation = useRef<((...args: A) => void) | null>(null);

  return useMemo(
    () => ({
      call: (...args: A) => implementation.current?.(...args),
      register: (next: (...args: A) => void) => {
        implementation.current = next;
        return () => {
          // A later registration owns the slot; unmounting the earlier
          // implementation must not empty it.
          if (implementation.current === next) implementation.current = null;
        };
      },
    }),
    [],
  );
}
