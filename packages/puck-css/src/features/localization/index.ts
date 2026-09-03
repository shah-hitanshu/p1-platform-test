/**
 * Localization Feature
 *
 * Lets site managers create a locale-tagged translation of an existing page,
 * linked to its canonical document. The per-field controls self-gate on whether
 * the current document is a translation, so they stay inert on canonical pages.
 */

import type { P1FeaturePlugin } from '../../core/plugin-types.js';
import { buildLocalizationOverrides } from './puck-overrides.js';

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
};
