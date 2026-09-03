/**
 * Translatability Toggle
 *
 * Presentational per-prop toggle. On (checked) means the prop is natural-language
 * text worth translating (the default); off marks it non-translatable. The
 * decision is shared across all languages, so the write target is the canonical
 * page — handled by the caller via onToggle.
 */

import React from 'react';

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
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 'var(--puck-font-size-xxxs, 12px)',
        marginBlockEnd: 0,
        color: 'var(--puck-color-grey-05, #767676)',
      }}
      title="Translatable text. Turn off for values that should not be translated (e.g. a date or SKU)."
    >
      <input
        type="checkbox"
        data-testid="loc-translatable-toggle"
        checked={translatable}
        disabled={readOnly}
        onChange={() => {
          if (readOnly) return;
          onToggle(!translatable);
        }}
      />
      <span>Translatable</span>
    </label>
  );
}
