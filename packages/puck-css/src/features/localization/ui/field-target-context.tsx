/**
 * Field Target Context
 *
 * Carries the prop a fields-panel field acts on from the fieldTypes override,
 * which is the only place Puck says which prop a field addresses, down to the
 * fieldLabel override, which renders the label row but is told only the label
 * text. A field addressing no prop the stored maps can key carries a null.
 */

import React, { createContext, useContext } from 'react';
import type { PropTarget } from '../prop-target.js';

const FieldTargetContext = createContext<PropTarget | null>(null);

export function FieldTargetProvider({
  target,
  children,
}: {
  target: PropTarget | null;
  children: React.ReactNode;
}): React.ReactElement {
  return <FieldTargetContext.Provider value={target}>{children}</FieldTargetContext.Provider>;
}

/**
 * The prop the surrounding field addresses. A label rendered outside any field
 * — and one for a nested subfield, whose provider carries a null — reads null.
 */
export function useFieldTarget(): PropTarget | null {
  return useContext(FieldTargetContext);
}
