/**
 * LocaleField
 *
 * Picks one of a site's market locales. The options are the site's registry, so
 * a locale that isn't configured can't be typed in. Each market is searchable by
 * its native name, its English name, and its tag, so `Deutsch`, `German`, and
 * `de` all reach the same row.
 *
 * No locale is the field's empty state, not an option: the placeholder reads
 * `Unset` and clearing the field returns to it. Nothing is privileged as a
 * site's original language, so there is no locale to fall back to.
 */

import React, { useCallback, useMemo } from 'react';
import { Combobox } from '@pantheon-systems/pds-toolkit-react';
import styles from './LocaleField.module.css';

export interface LocaleFieldOption {
  /** BCP-47 tag, e.g. `de-DE`. */
  tag: string;
  /** The locale's name in its own language, e.g. `Deutsch`. */
  native: string;
  /** The locale's name in English, e.g. `German`. */
  english: string;
}

export interface LocaleFieldProps {
  id: string;
  label: string;
  /** The site's configured markets. With none, the field does not render. */
  locales: LocaleFieldOption[];
  /** Receives the chosen tag, or null when the field is cleared. */
  onChange: (tag: string | null) => void;
  /** Shown under the field. Omit while the field is untouched. */
  message?: string;
  /**
   * Tag of a locale already settled elsewhere. Read once, as the option to
   * start on: the field owns its text from then on.
   */
  defaultValue?: string;
}

export function LocaleField({
  id,
  label,
  locales,
  onChange,
  message,
  defaultValue,
}: LocaleFieldProps): React.ReactElement | null {
  const options = useMemo(
    () =>
      locales.map((locale) => ({
        value: locale.tag,
        label: locale.native,
        searchIndex: [locale.native, locale.english, locale.tag],
        optionDisplay: (
          <span className={styles.option}>
            <span className={styles.native}>{locale.native}</span>
            <span className={styles.english}>{locale.english}</span>
            <span className={styles.tag}>{locale.tag}</span>
          </span>
        ),
      })),
    [locales],
  );

  const handleSelect = useCallback(
    (option: { value: string }) => {
      onChange(option.value);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  if (locales.length === 0) return null;

  // Deliberately uncontrolled: passing `value` back in discards the text the
  // combobox sets on select, leaving the input blank while a locale is held.
  return (
    <Combobox
      id={id}
      data-testid={id}
      className={styles.field}
      label={label}
      options={options}
      defaultValue={defaultValue}
      placeholder="Unset"
      hasClearButton
      showUnfilteredOptions
      message={message}
      size="s"
      onOptionSelect={handleSelect}
      onClear={handleClear}
    />
  );
}
