/**
 * Authority Toggle
 *
 * Presentational per-prop toggle for a translation. On (checked) means the
 * translation owns the prop and writes it for this language; off means the prop
 * follows the source page. The write, and the choice between storing an override
 * and dropping one, belong to the caller via onToggle.
 */

import React, { useId, type ComponentPropsWithoutRef } from 'react';
import { Switch } from '@pantheon-systems/pds-toolkit-react';
import styles from './TranslationGlyph.module.css';

interface AuthorityToggleProps {
  broken: boolean;
  onToggle: (next: boolean) => void;
  readOnly?: boolean;
}

export function AuthorityToggle({
  broken,
  onToggle,
  readOnly,
}: AuthorityToggleProps): React.ReactElement {
  const id = useId();
  return (
    <div className={styles.settings}>
      <Switch
        id={id}
        label="Written for this language"
        checked={broken}
        disabled={readOnly}
        showStatusLabel={false}
        inputProps={{ 'data-testid': 'loc-authority-toggle' } as ComponentPropsWithoutRef<'input'>}
        onChange={() => {
          if (readOnly) return;
          onToggle(!broken);
        }}
      />
      <p className={styles.explanation}>When off, this field follows the source page.</p>
    </div>
  );
}
