/**
 * Localization Data
 *
 * The document-scoped state behind the per-prop controls: a translation's
 * authority overrides, and the translatability map the canonical page carries in
 * its own content. One control mounts per field in the panel and they share a
 * query key per document, so a panel of any width costs one request and a write
 * lands in every control at once.
 */

import { useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createUsePuck, type Data } from '@puckeditor/core';
import type { AuthorityOverridesResult, PropAuthority } from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { useP1SdkQueryClient } from '../../data/query-provider.js';
import { needsOverride } from './authority.js';
import { isCanonicalDocument, isTranslationDocument } from './relation.js';
import type { PropTarget } from './prop-target.js';
import { applyTranslatable } from './translatable.js';

const AUTHORITY_KEY = 'p1-localization-authority';

const usePuckState = createUsePuck();

export interface LocalizationData {
  /** The current document is a translation of a canonical page. */
  isTranslation: boolean;
  /** The current document is a canonical page. */
  isCanonical: boolean;
  /** Resolved authority overrides for a translation; null on a canonical page. */
  authority: AuthorityOverridesResult | null;
  /** The canonical page's translatability map, as the editor currently holds it. */
  translatableMap: unknown;
  /**
   * The document's answer has arrived. A control rendered without it would show
   * a guessed authority, and a click on that guess writes the wrong thing, so a
   * read that failed leaves this false rather than falling back to a default.
   */
  loaded: boolean;
  /** A write is in flight. */
  busy: boolean;
  setAuthority: (target: PropTarget & { authority: PropAuthority }) => void;
  setTranslatable: (target: PropTarget & { translatable: boolean }) => void;
}

export function useLocalizationData(): LocalizationData {
  const css = useP1PuckOptional();
  const client = css?.client;
  const siteId = css?.siteId;
  const branchId = css?.branchId;
  const currentDocument = css?.currentDocument;
  const documentId = currentDocument?.id;
  const notifications = css?.notifications;

  const isTranslation = isTranslationDocument(currentDocument);
  const isCanonical = isCanonicalDocument(currentDocument);

  const addressable = Boolean(client && siteId && branchId);
  const queryClient = useP1SdkQueryClient();

  const authorityKey = [AUTHORITY_KEY, siteId, branchId, documentId];

  const authorityQuery = useQuery({
    queryKey: authorityKey,
    queryFn: async (): Promise<AuthorityOverridesResult | null> => {
      if (!client || !siteId || !branchId || !documentId) return null;
      return client.translations.getAuthorityOverrides(siteId, branchId, documentId);
    },
    enabled: addressable && isTranslation && Boolean(documentId),
  }, queryClient);

  const authority = authorityQuery.data ?? null;

  // Absent authority resolves every prop to 'canonical', so a failed read is
  // indistinguishable from a translation that inherits everything. Say so, and
  // withhold the controls rather than offering a guess to click.
  const readError = authorityQuery.error;
  useEffect(() => {
    if (!readError) return;
    notifications?.addError(
      readError instanceof Error
        ? `Could not read which fields this translation owns: ${readError.message}`
        : 'Could not read which fields this translation owns.',
    );
  }, [readError, notifications]);

  /**
   * Moves the prop to the given authority. An override is stored only where the
   * slot's default disagrees; where it already agrees, dropping the override
   * reaches the same authority and leaves the prop following its template.
   *
   * The response is the document's whole override map, so the writes queue —
   * two in flight would apply their maps in completion order.
   */
  const authorityMutation = useMutation({
    scope: { id: `${AUTHORITY_KEY}:${documentId ?? ''}` },
    mutationFn: async ({
      slotId,
      propName,
      authority: target,
    }: PropTarget & { authority: PropAuthority }) => {
      if (!client || !siteId || !branchId || !documentId) return null;
      return needsOverride(authority, slotId, target)
        ? client.translations.setAuthorityOverride(siteId, branchId, documentId, {
            slotId,
            propName,
            authority: target,
          })
        : client.translations.clearAuthorityOverride(siteId, branchId, documentId, {
            slotId,
            propName,
          });
    },
    onSuccess: (result) => {
      if (result) queryClient.setQueryData(authorityKey, result);
    },
    // The control renders the server's answer, so a failed write leaves it
    // showing the authority the prop still has — indistinguishable from a click
    // that never happened unless the failure is said out loud.
    onError: (err: unknown) => {
      notifications?.addError(
        err instanceof Error
          ? `Could not change what owns this field: ${err.message}`
          : 'Could not change what owns this field.',
      );
    },
  }, queryClient);

  // The map is part of the canonical page's content, and the toggle only renders
  // on the canonical page — so it is read from, and written back to, the document
  // open in the editor. Selecting the map rather than the whole data keeps a
  // panel of controls off the per-keystroke render path.
  const translatableMap = usePuckState(
    (s) => (s.appState.data.root.props as Record<string, unknown> | undefined)?._localeTranslatable,
  );
  const dispatch = usePuckState((s) => s.dispatch);

  const setTranslatable = useCallback(
    ({ slotId, propName, translatable }: PropTarget & { translatable: boolean }) => {
      dispatch({
        type: 'setData',
        recordHistory: true,
        data: (previous: Data) =>
          applyTranslatable(
            previous as unknown as Record<string, unknown>,
            slotId,
            propName,
            translatable,
          ) as unknown as Partial<Data>,
      });
    },
    [dispatch],
  );

  return {
    isTranslation,
    isCanonical,
    loaded: isTranslation ? authorityQuery.isSuccess : true,
    authority,
    translatableMap,
    busy: authorityMutation.isPending,
    setAuthority: authorityMutation.mutate,
    setTranslatable,
  };
}
