/**
 * PageNavigator component.
 *
 * Overlay panel for navigating between pages (documents) in the editor.
 * Uses createPortal + position:fixed to escape header overflow constraints.
 * Filters out archived documents and internal _registry/* paths.
 *
 * The `portalStyle` prop should be computed SYNCHRONOUSLY in the click handler
 * of the parent (before this component first renders) to avoid a two-render
 * flash where the portal appears at y=0 before being repositioned.
 */

import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './PageNavigator.module.css';

export interface PageNavigatorDocument {
  id: string;
  path: string;
  archived: boolean;
  isPublished?: boolean;
  inherited?: boolean;
}

export interface PageNavigatorProps {
  documents: PageNavigatorDocument[];
  currentDocument: PageNavigatorDocument | null;
  onSelect: (doc: PageNavigatorDocument) => void;
  onClose: () => void;
  open: boolean;
  /** Whether the current branch is main/live. Inherited docs are dimmed when false. */
  isMainBranch?: boolean;
  /** Called when the user creates a new page. If omitted, the "+ New page" button has no effect. */
  onCreateDocument?: (path: string) => Promise<void>;
  /**
   * Pre-computed fixed positioning style. Caller must compute this
   * synchronously (e.g. in the trigger's onClick) so it is available on the
   * first render — avoids a layout flash at document top.
   */
  portalStyle?: React.CSSProperties;
}

export function PageNavigator({
  documents,
  currentDocument,
  onSelect,
  onClose,
  open,
  isMainBranch,
  onCreateDocument,
  portalStyle,
}: PageNavigatorProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newPath.trim() || !onCreateDocument) return;
      const path = newPath.startsWith('/') ? newPath.slice(1) : newPath;
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      setCreateError(null);
      try {
        await onCreateDocument(path);
        setNewPath('');
        setIsCreating(false);
        // Navigate to the newly created page
        onSelect({ id: normalizedPath, path: normalizedPath, archived: false });
        onClose();
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Failed to create page');
      }
    },
    [newPath, onCreateDocument, onSelect, onClose],
  );

  if (!open) return null;

  // Filter: exclude archived, exclude internal _* paths (e.g. /_registry/, _registry/)
  // Normalize away a leading slash so both `/path` and `path` forms are caught.
  const visible = documents.filter((doc) => {
    if (doc.archived) return false;
    const normalizedPath = doc.path.startsWith('/') ? doc.path.slice(1) : doc.path;
    return !normalizedPath.startsWith('_');
  });

  const filtered = query
    ? visible.filter((doc) =>
        doc.path.toLowerCase().includes(query.toLowerCase()),
      )
    : visible;

  const content = (
    <div
      className={styles.root}
      role="dialog"
      aria-label="Page navigator"
      style={portalStyle}
    >
      <div className={styles.header}>
        <input
          autoFocus
          type="text"
          data-testid="page-navigator-search"
          className={styles.search}
          placeholder="Search pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <ul className={styles.list}>
        {filtered.map((doc) => {
          const isCurrent =
            currentDocument !== null && doc.id === currentDocument.id;
          const isLiveOnly = isMainBranch === false && doc.inherited === true;
          return (
            <li key={doc.id}>
              <button
                type="button"
                data-testid="page-navigator-item"
                data-inherited={isLiveOnly ? 'true' : undefined}
                className={`${styles.item}${isCurrent ? ` ${styles.itemCurrent}` : ''}${isLiveOnly ? ` ${styles.itemInherited}` : ''}`}
                onClick={() => { onSelect(doc); setQuery(''); }}
                aria-current={isCurrent ? 'page' : undefined}
              >
                {doc.path}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className={styles.empty}>No pages found</li>
        )}
      </ul>

      <div className={styles.footer}>
        {isCreating ? (
          <form
            data-testid="page-navigator-create-form"
            className={styles.createForm}
            onSubmit={handleCreate}
          >
            <input
              autoFocus
              type="text"
              data-testid="page-navigator-create-input"
              className={styles.createInput}
              placeholder="page-path"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
            />
            <div className={styles.createActions}>
              <button type="submit" className={styles.createSubmit}>
                Create
              </button>
              <button
                type="button"
                data-testid="page-navigator-create-cancel"
                className={styles.createCancel}
                onClick={() => { setIsCreating(false); setNewPath(''); setCreateError(null); }}
              >
                Cancel
              </button>
            </div>
            {createError && (
              <div data-testid="page-navigator-create-error" className={styles.createError}>
                {createError}
              </div>
            )}
          </form>
        ) : (
          <button
            type="button"
            data-testid="page-navigator-new"
            className={styles.newButton}
            onClick={onCreateDocument ? () => setIsCreating(true) : undefined}
          >
            + New page
          </button>
        )}
      </div>
    </div>
  );

  return portalStyle ? createPortal(content, document.body) : content;
}
