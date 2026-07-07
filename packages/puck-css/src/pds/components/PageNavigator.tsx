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
import type { Template } from '../../features/content-type-templates/types.js';

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
  onCreateDocument?: (path: string, template?: Template | null) => Promise<void>;
  /**
   * Called when "+ New page" is clicked. When provided, it takes over the button
   * (e.g. to open the Create Page modal) instead of the inline create form.
   */
  onCreatePage?: () => void;
  /**
   * Called when "+ New template" is clicked on the Templates tab (e.g. to open
   * the Create Page modal directly on the New-template form). When omitted, the
   * button is not shown.
   */
  onCreateTemplate?: () => void;
  /** Available templates for document creation. When non-empty, a template selector step is shown. */
  templates?: Template[];
  /** Whether templates are still loading. */
  templatesLoading?: boolean;
  /**
   * Pre-computed fixed positioning style. Caller must compute this
   * synchronously (e.g. in the trigger's onClick) so it is available on the
   * first render — avoids a layout flash at document top.
   */
  portalStyle?: React.CSSProperties;
}

type CreationStep = 'idle' | 'template' | 'path';

export function PageNavigator({
  documents,
  currentDocument,
  onSelect,
  onClose,
  open,
  isMainBranch,
  onCreateDocument,
  onCreatePage,
  onCreateTemplate,
  templates,
  templatesLoading,
  portalStyle,
}: PageNavigatorProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'pages' | 'templates'>('pages');
  const [creationStep, setCreationStep] = useState<CreationStep>('idle');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [newPath, setNewPath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const hasTemplates = templates && templates.length > 0;

  const handleNewPageClick = useCallback(() => {
    if (hasTemplates) {
      setCreationStep('template');
    } else {
      setCreationStep('path');
    }
  }, [hasTemplates]);

  const handleTemplateSelect = useCallback((template: Template | null) => {
    setSelectedTemplate(template);
    setCreationStep('path');
  }, []);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!onCreateDocument) return;

      const trimmedPath = newPath.trim();
      if (!trimmedPath) return;

      // Special case: "/" is a valid path for the homepage
      const path = trimmedPath === '/' ? '/' : (trimmedPath.startsWith('/') ? trimmedPath.slice(1) : trimmedPath);
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      setCreateError(null);
      try {
        await onCreateDocument(path, selectedTemplate);
        setNewPath('');
        setCreationStep('idle');
        setSelectedTemplate(null);
        // Navigate to the newly created page
        onSelect({ id: normalizedPath, path: normalizedPath, archived: false });
        onClose();
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Failed to create page');
      }
    },
    [newPath, onCreateDocument, selectedTemplate, onSelect, onClose],
  );

  const handleCancel = useCallback(() => {
    setCreationStep('idle');
    setNewPath('');
    setCreateError(null);
    setSelectedTemplate(null);
  }, []);

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

  // Templates tab: browse existing templates and open them for editing.
  const templateList = templates ?? [];
  const filteredTemplates = query
    ? templateList.filter((t) =>
        (t.label || t.name).toLowerCase().includes(query.toLowerCase()),
      )
    : templateList;
  const showTemplatesTab = activeTab === 'templates';

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
          placeholder={showTemplatesTab ? 'Search templates…' : 'Search pages…'}
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

      {hasTemplates && (
        <div className={styles.tabs} role="tablist" aria-label="Pages and templates">
          <button
            type="button"
            role="tab"
            data-testid="page-navigator-tab-pages"
            aria-selected={!showTemplatesTab}
            className={`${styles.tab}${!showTemplatesTab ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setActiveTab('pages')}
          >
            Pages
          </button>
          <button
            type="button"
            role="tab"
            data-testid="page-navigator-tab-templates"
            aria-selected={showTemplatesTab}
            className={`${styles.tab}${showTemplatesTab ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setActiveTab('templates')}
          >
            Templates
          </button>
        </div>
      )}

      {showTemplatesTab ? (
        <ul className={styles.list}>
          {filteredTemplates.map((t) => {
            const path = `_registry/templates/${t.name}`;
            const isCurrent = currentDocument?.path === path;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  data-testid="page-navigator-template-item"
                  className={`${styles.item}${isCurrent ? ` ${styles.itemCurrent}` : ''}`}
                  onClick={() => {
                    onSelect({ id: path, path, archived: false });
                    setQuery('');
                  }}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {t.label || t.name}
                </button>
              </li>
            );
          })}
          {filteredTemplates.length === 0 && (
            <li className={styles.empty}>No templates found</li>
          )}
        </ul>
      ) : (
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
      )}

      {showTemplatesTab && onCreateTemplate && (
        <div className={styles.footer}>
          <button
            type="button"
            data-testid="page-navigator-new-template"
            className={styles.newButton}
            onClick={onCreateTemplate}
          >
            + New template
          </button>
        </div>
      )}

      {!showTemplatesTab && (
      <div className={styles.footer}>
        {creationStep === 'template' ? (
          <div data-testid="template-selector" className={styles.templateSelector}>
            {templatesLoading ? (
              <div data-testid="template-selector-loading" className={styles.templateSelectorLoading}>
                Loading templates...
              </div>
            ) : (
              <>
                <div className={styles.templateSelectorHeader}>Choose a template</div>
                <div className={styles.templateSelectorGrid}>
                  <button
                    type="button"
                    className={styles.templateOption}
                    onClick={() => handleTemplateSelect(null)}
                  >
                    <span className={styles.templateOptionLabel}>Blank Page</span>
                    <span className={styles.templateOptionDesc}>Start from scratch</span>
                  </button>
                  {(templates ?? []).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={styles.templateOption}
                      onClick={() => handleTemplateSelect(t)}
                    >
                      <span className={styles.templateOptionLabel}>{t.label || t.name}</span>
                      {t.description && (
                        <span className={styles.templateOptionDesc}>{t.description}</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.createCancel}
                  onClick={handleCancel}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        ) : creationStep === 'path' ? (
          <form
            data-testid="page-navigator-create-form"
            className={styles.createForm}
            onSubmit={handleCreate}
          >
            {selectedTemplate && (
              <div className={styles.selectedTemplateBadge}>
                Template: {selectedTemplate.label || selectedTemplate.name}
              </div>
            )}
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
                onClick={handleCancel}
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
            onClick={
              onCreatePage ?? (onCreateDocument ? handleNewPageClick : undefined)
            }
          >
            + New page
          </button>
        )}
      </div>
      )}
    </div>
  );

  return portalStyle ? createPortal(content, document.body) : content;
}
