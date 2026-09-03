/**
 * PageNotFound component.
 *
 * Canvas state for an editor path that has no page behind it. Typography comes
 * from the PDS composite utilities (`pds-heading-xl`, `pds-copy-m`), which
 * `P1App` adopts into the document alongside the rest of pds-core.
 *
 * Landing here is a normal way to reach a page that has not been made yet, so
 * the panel offers to make it rather than reporting a failure. Users who cannot
 * create pages are only offered the way back to the home page, and are not asked
 * a question they cannot answer.
 *
 * This is the editor's own state — the public site's 404 is unrelated and
 * unaffected.
 */

import React, { useCallback, useState } from 'react';
import { Button } from '@pantheon-systems/pds-toolkit-react';
import styles from './PageNotFound.module.css';

export interface PageNotFoundProps {
  /** Whether the current user may create the missing page. */
  canCreate?: boolean;
  /** Create the page. Rejects with an Error whose message is shown. */
  onCreate?: () => Promise<void>;
  /** Navigate to the site's home page. */
  onOpenHome: () => void;
  'data-testid'?: string;
}

export function PageNotFound({
  canCreate = false,
  onCreate,
  onOpenHome,
  'data-testid': dataTestId,
}: PageNotFoundProps): React.ReactElement {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offersCreate = canCreate && !!onCreate;

  const handleCreate = useCallback(async () => {
    if (!onCreate) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }, [onCreate]);

  return (
    <div className={styles.panel} data-testid={dataTestId}>
      <div className={styles.content}>
        <h2 className={`pds-heading-xl ${styles.heading}`}>This page doesn&apos;t exist</h2>
        {offersCreate && <p className={`pds-copy-m ${styles.message}`}>Do you want to create it?</p>}

        <div className={styles.actions}>
          {offersCreate && (
            <Button
              label={creating ? 'Creating page…' : 'Create page'}
              onClick={() => void handleCreate()}
              disabled={creating}
              variant="primary"
              size="m"
              data-testid="editor-page-not-found-create"
            />
          )}
          <Button
            label="Open home page"
            onClick={onOpenHome}
            variant="secondary"
            size="m"
            data-testid="editor-page-not-found-home"
          />
        </div>

        {error && (
          <p className={`pds-copy-s ${styles.error}`} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
