/**
 * Localization Feature
 *
 * Lets site managers create a locale-tagged translation of an existing page,
 * linked to its canonical document. The per-field controls self-gate on whether
 * the current document is a translation, so they stay inert on canonical pages.
 * The toolbar carries the locale switcher and, while a translation has changes
 * to reconcile, the control that opens them.
 */

import type { P1FeaturePlugin } from '../../core/plugin-types.js';
import { buildLocalizationOverrides } from './puck-overrides.js';
import { LocaleSwitcherControl } from './ui/LocaleSwitcherControl.js';
import { UpstreamChangesControl } from './ui/UpstreamChangesControl.js';

export type {
  LocalizationRelation,
  CreateTranslationParams,
  CreateTranslationResult,
  TranslationVariant,
  ListTranslationsResult,
  TranslatablePage,
} from './types.js';

export const localizationPlugin: P1FeaturePlugin = {
  name: 'localization',
  priority: 70,
  puckOverrides: (deps) => buildLocalizationOverrides(deps),
  toolbarActions: (deps) => (
    <>
      <LocaleSwitcherControl
        openDocument={deps.openDocument}
        openCreatePage={deps.openCreatePage}
      />
      <UpstreamChangesControl relationType="localization" />
    </>
  ),
};
