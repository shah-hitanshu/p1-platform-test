/**
 * Create a locale version
 *
 * Wraps the editor's create-translation call with what the localization UI needs
 * afterwards: the variant lists every switcher reads are stale the moment a new
 * version exists, so they are re-read rather than left showing the market as
 * empty until the editor is reloaded.
 */

import { useCallback } from 'react';
import type { Document, TranslationMode } from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { useP1SdkQueryClient } from '../../data/query-provider.js';
import { LOCALE_VARIANTS_KEY } from './useLocaleRows.js';

export interface CreateLocaleVersion {
  canonicalDocumentId: string;
  locale: string;
  mode?: TranslationMode;
}

/** Null where no editor context is available, which is how a host without one stays inert. */
export function useCreateTranslation(): ((params: CreateLocaleVersion) => Promise<Document>) | null {
  const css = useP1PuckOptional();
  const queryClient = useP1SdkQueryClient();
  const createTranslation = css?.createTranslation;

  const create = useCallback(
    async (params: CreateLocaleVersion): Promise<Document> => {
      if (!createTranslation) throw new Error('No editor to create a locale version in');
      const document = await createTranslation(params);
      await queryClient.invalidateQueries({ queryKey: [LOCALE_VARIANTS_KEY] });
      return document;
    },
    [createTranslation, queryClient],
  );

  return createTranslation ? create : null;
}
