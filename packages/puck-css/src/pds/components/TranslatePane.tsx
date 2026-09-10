/**
 * TranslatePane
 *
 * The "Translate a page" step of CreatePageModal: choose a source page (when the
 * modal has a list to choose from), a locale to translate into, and how the new
 * version starts.
 */

import React from 'react';
import { LocaleField } from './LocaleField.js';
import type { LocaleFieldOption } from './LocaleField.js';
import styles from './CreatePageModal.module.css';

type TranslationSeedMode = 'copy' | 'empty' | 'ai';

interface SeedMode {
  key: TranslationSeedMode;
  title: string;
  description: string;
  /** Copy shown in place of selection while the mode has no backing. */
  comingSoon?: string;
}

const SEEDED_FROM_COPY: TranslationSeedMode = 'copy';

// `copy` is the mode that exists. The other two are shown rather than hidden,
// so the choice the flow will offer is legible before it can be made.
const SEED_MODES: SeedMode[] = [
  {
    key: 'copy',
    title: 'Start from a copy',
    description: 'Seed this locale with the page’s current copy and translate it in the editor.',
  },
  {
    key: 'empty',
    title: 'Start empty',
    description: 'Keep the page structure but clear the copy, and write the locale from scratch.',
    comingSoon: 'Coming soon',
  },
  {
    key: 'ai',
    title: 'Translate with AI',
    description: 'Machine-translate the page now, then review it before publishing.',
    comingSoon: 'Coming soon',
  },
];

export interface TranslatePaneProps {
  localesFailed: boolean;
  onRetryLocales?: () => void;
  locales: LocaleFieldOption[];
  hasSourceToTranslate: boolean;
  canChooseSource: boolean;
  translatablePages: { id: string; path: string; title?: string }[];
  translateSource: string | null;
  onChooseSource: (id: string | null) => void;
  chosenLocale: LocaleFieldOption | null;
  onChooseLocale: (tag: string | null) => void;
}

export function TranslatePane({
  localesFailed,
  onRetryLocales,
  locales,
  hasSourceToTranslate,
  canChooseSource,
  translatablePages,
  translateSource,
  onChooseSource,
  chosenLocale,
  onChooseLocale,
}: TranslatePaneProps): React.ReactElement {
  return (
    <fieldset data-testid="create-page-translate" className={styles.startFrom}>
      <legend className={styles.sectionLabel}>Translate a page</legend>
      {localesFailed ? (
        <p data-testid="create-page-translate-locales-failed" className={styles.fieldHint}>
          This site&rsquo;s locales could not be loaded.{' '}
          <button
            type="button"
            data-testid="create-page-translate-retry-locales"
            className={styles.linkButton}
            onClick={onRetryLocales}
          >
            Try again
          </button>
        </p>
      ) : locales.length === 0 ? (
        <p data-testid="create-page-translate-no-markets" className={styles.fieldHint}>
          This site has no market locales configured yet.
        </p>
      ) : !hasSourceToTranslate ? (
        <p data-testid="create-page-translate-empty" className={styles.fieldHint}>
          There is no page to translate yet.
        </p>
      ) : (
        <div className={styles.fields}>
          {canChooseSource && (
            <div className={styles.field}>
              <label htmlFor="create-page-translate-source" className={styles.fieldLabel}>
                Page <span className={styles.required}>*</span>
              </label>
              <select
                id="create-page-translate-source"
                data-testid="create-page-translate-source"
                className={styles.input}
                value={translateSource ?? ''}
                onChange={(e) => onChooseSource(e.target.value || null)}
              >
                <option value="">Choose a page</option>
                {translatablePages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title || page.path}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={styles.field}>
            <LocaleField
              id="create-page-translate-locale"
              label="Locale"
              locales={locales}
              defaultValue={chosenLocale?.tag}
              onChange={onChooseLocale}
              message={
                chosenLocale ? `Adds a ${chosenLocale.english} version of this page.` : undefined
              }
            />
          </div>
          <fieldset className={styles.fieldFull} data-testid="create-page-seed-modes">
            <legend className={styles.fieldLabel}>How it starts</legend>
            <div className={styles.modeList}>
              {SEED_MODES.map((mode) => {
                const chosen = mode.key === SEEDED_FROM_COPY;
                return (
                  <button
                    key={mode.key}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    data-testid={`create-page-seed-mode-${mode.key}`}
                    className={`${styles.contentTypeCard}${
                      chosen ? ` ${styles.contentTypeCardSelected}` : ''
                    }`}
                    disabled={!chosen}
                  >
                    <span className={styles.modeHeading}>
                      <span className={styles.contentTypeName}>{mode.title}</span>
                      {mode.comingSoon && (
                        <span className={styles.modeBadge}>{mode.comingSoon}</span>
                      )}
                    </span>
                    <span className={styles.contentTypeDescription}>{mode.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}
    </fieldset>
  );
}
