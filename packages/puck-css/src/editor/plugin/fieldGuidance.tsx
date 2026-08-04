/**
 * Per-field help text, rendered under the input.
 *
 * Opt in with Puck's per-field `metadata`, the same extension point the
 * collapsible section uses:
 *
 *   metadata: { help: 'Always shown.', helpWhenEmpty: 'Shown while empty.' }
 *
 * `helpWhenEmpty` is how an inheriting field says where its value comes from,
 * since a field is inheriting exactly while it is empty. Fields without either
 * key render unchanged.
 *
 * These are `fieldTypes` overrides, so Puck hands us its own field renderer as
 * `children` — the help is appended after it rather than replacing it. Note the
 * side effect of registering a type here: Puck subscribes to the value of every
 * field of that type, which is what makes the empty/authored switch work.
 */

import React from 'react';
import { FieldHelpText } from '../components/FieldHelpText.js';

export interface FieldGuidanceMetadata {
  help?: string;
  helpWhenEmpty?: string;
}

interface GuidedFieldProps {
  field: { metadata?: FieldGuidanceMetadata };
  value: unknown;
  children: React.ReactNode;
}

function WithHelpText({ field, value, children }: GuidedFieldProps): React.ReactElement {
  const { help, helpWhenEmpty } = field.metadata ?? {};
  const text = value === undefined || value === null || value === '' ? helpWhenEmpty ?? help : help;

  if (!text) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <FieldHelpText>{text}</FieldHelpText>
    </>
  );
}

/**
 * The field types help text is wired for. Select is included for the fields
 * whose fallback is a fixed default rather than another prop — it has no
 * `placeholder` to show one in, so the help line carries it alone.
 */
export const fieldGuidanceFieldTypes = {
  text: WithHelpText,
  textarea: WithHelpText,
  select: WithHelpText,
};

export function createFieldGuidanceOverrides(): {
  fieldTypes: typeof fieldGuidanceFieldTypes;
} {
  return { fieldTypes: fieldGuidanceFieldTypes };
}
