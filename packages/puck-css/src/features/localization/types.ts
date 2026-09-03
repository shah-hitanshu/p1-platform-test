/**
 * Localization - Core Types
 *
 * Client-facing localization types are re-exported from css-client; this module
 * carries the editor-side shapes used by the create-translation UI.
 */

export type {
  LocalizationRelation,
  CreateTranslationParams,
  CreateTranslationResult,
  TranslationVariant,
  ListTranslationsResult,
} from '@pantheon-systems/css-client';

/**
 * A canonical page eligible to be translated, as the create-page UI consumes it.
 */
export interface TranslatablePage {
  /** Canonical document id */
  id: string;
  /** Canonical document path */
  path: string;
}
