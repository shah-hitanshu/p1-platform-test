/**
 * Translatability Toggle
 *
 * Presentational per-prop toggle. On (checked) means the prop is natural-language
 * text worth translating (the default); off marks it non-translatable. The
 * decision is shared across all languages, so the write target is the canonical
 * page — handled by the caller via onToggle.
 */

import React, { useId, type ComponentPropsWithoutRef } from 'react';
import { Switch } from '@pantheon-systems/pds-toolkit-react';

interface TranslatabilityToggleProps {
  translatable: boolean;
  onToggle: (next: boolean) => void;
  readOnly?: boolean;
}

export function TranslatabilityToggle({
  translatable,
  onToggle,
  readOnly,
}: TranslatabilityToggleProps): React.ReactElement {
  const id = useId();
  return (
    <Switch
      id={id}
      label="Translatable"
      checked={translatable}
      disabled={readOnly}
      showStatusLabel={false}
      inputProps={{ 'data-testid': 'loc-translatable-toggle' } as ComponentPropsWithoutRef<'input'>}
      onChange={() => {
        if (readOnly) return;
        onToggle(!translatable);
      }}
    />
  );
}
