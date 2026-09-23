/**
 * Locale Switcher Control
 *
 * Joins the switcher to the editor: the site's markets and the open page's
 * versions come from the localization queries, and choosing a market either
 * opens the version it holds or starts one where it holds none. Both of those
 * belong to the editor, so the control asks for them rather than doing them.
 *
 * A translation also carries its drift from the source: the switcher states it,
 * and the drawer behind it lists the changes.
 */

import React, { useCallback, useState } from 'react';
import type { P1Client } from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { derivesFromUpstream } from '../relation.js';
import { useLocaleRows } from '../useLocaleRows.js';
import { useLocaleReviewStatus } from '../useLocaleReviewStatus.js';
import { useUpstreamReview } from '../useUpstreamReview.js';
import { LocaleSwitcher, type LocaleSwitcherProps } from './LocaleSwitcher.js';
import { UpstreamChangesDrawer } from './UpstreamChangesDrawer.js';

export interface LocaleSwitcherControlProps {
  openDocument: (path: string) => void;
  openCreatePage: (params?: { locale?: string; sourceDocumentId?: string }) => void;
}

export function LocaleSwitcherControl({
  openDocument,
  openCreatePage,
}: LocaleSwitcherControlProps): React.ReactElement | null {
  const { rows, markets, loading, failed, canonical, documents, retry } = useLocaleRows();
  const css = useP1PuckOptional();
  const [open, setOpen] = useState(false);
  const reviewStatus = useLocaleReviewStatus(
    css?.client,
    css?.siteId,
    css?.branchId,
    rows,
    open,
    css?.currentDocument?.id ?? null,
  );

  const openLocale = useCallback(
    (documentId: string) => {
      const target = documents.find((doc) => doc.id === documentId);
      if (!target) return;
      openDocument(target.path);
    },
    [documents, openDocument],
  );

  const addLocale = useCallback(
    (locale: string) => {
      if (!canonical) return;
      openCreatePage({ locale, sourceDocumentId: canonical.id });
    },
    [canonical, openCreatePage],
  );

  const switcher: LocaleSwitcherProps = {
    rows,
    markets,
    documents,
    loading,
    failed,
    open,
    onOpenChange: setOpen,
    reviewStatus,
    onRetry: retry,
    onOpenLocale: openLocale,
    onAddLocale: addLocale,
  };

  const client = css?.client;
  const siteId = css?.siteId;
  const branchId = css?.branchId;
  const currentDocument = css?.currentDocument;

  if (
    !client ||
    !siteId ||
    !branchId ||
    !currentDocument ||
    !derivesFromUpstream('localization', currentDocument)
  ) {
    return <LocaleSwitcher {...switcher} />;
  }

  return (
    // The drawer's open state and the summary belong to the page being
    // reconciled; keying on it closes the drawer when the page changes.
    <LocaleSwitcherReview
      key={`${siteId}:${branchId}:${currentDocument.id}`}
      switcher={switcher}
      client={client}
      siteId={siteId}
      branchId={branchId}
      documentId={currentDocument.id}
      documentPath={currentDocument.path}
      documentLocale={currentDocument.locale}
    />
  );
}

interface LocaleSwitcherReviewProps {
  switcher: LocaleSwitcherProps;
  client: P1Client;
  siteId: string;
  branchId: string;
  documentId: string;
  documentPath: string;
  documentLocale: string | undefined;
}

function LocaleSwitcherReview({
  switcher,
  client,
  siteId,
  branchId,
  documentId,
  documentPath,
  documentLocale,
}: LocaleSwitcherReviewProps): React.ReactElement {
  const [reviewing, setReviewing] = useState(false);
  const close = useCallback(() => setReviewing(false), []);
  const review = useUpstreamReview(client, siteId, branchId, documentId, 'localization');

  return (
    <>
      <LocaleSwitcher
        {...switcher}
        drift={{
          outstanding: review.outstanding,
          structuralOnly: review.structuralOnly,
          onReview: () => setReviewing(true),
        }}
      />
      <UpstreamChangesDrawer
        review={review}
        open={reviewing}
        onClose={close}
        documentPath={documentPath}
        documentLocale={documentLocale}
      />
    </>
  );
}
