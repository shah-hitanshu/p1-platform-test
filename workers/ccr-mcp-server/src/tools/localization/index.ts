import { defineTools } from '../shared/define-tools.functions.js';
import { createTranslationTool } from './create-translation.js';
import { getDriftTool } from './get-drift.js';
import { listLocaleVariantsTool } from './list-locale-variants.js';

export const localizationTools = defineTools({
  create_translation: createTranslationTool,
  list_locale_variants: listLocaleVariantsTool,
  get_drift: getDriftTool,
});
