/**
 * Locale Switcher Control
 *
 * Joins the switcher to the editor: the site's markets and the open page's
 * versions come from the localization queries, and choosing a market either
 * opens the version it holds or starts one where it holds none. Both of those
 * belong to the editor, so the control asks for them rather than doing them.
 */

import React, { useCallback, useState } from 'react';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { useLocaleRows } from '../useLocaleRows.js';
import { useLocaleReviewStatus } from '../useLocaleReviewStatus.js';
import { LocaleSwitcher } from './LocaleSwitcher.js';

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
  const reviewStatus = useLocaleReviewStatus(css?.client, css?.siteId, css?.branchId, rows, open);

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

  return (
    <LocaleSwitcher
      rows={rows}
      markets={markets}
      documents={documents}
      loading={loading}
      failed={failed}
      open={open}
      onOpenChange={setOpen}
      reviewStatus={reviewStatus}
      onRetry={retry}
      onOpenLocale={openLocale}
      onAddLocale={addLocale}
    />
  );
}
