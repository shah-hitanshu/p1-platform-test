/**
 * P1EditorHeader
 *
 * Top chrome bar for the PDS v2 editor theme.
 * Renders: P1 branding, WorkstreamSwitcher, page selector button,
 * user avatar with account menu, and the "Compare with Live" button
 * (non-main branches only).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Avatar, PantheonLogo } from '@pantheon-systems/pds-toolkit-react';
import type { ActorPresence } from '@pantheon-systems/css-client';
import type { Template, TemplateSummary } from '../../features/content-type-templates/types.js';
import { aiPanelStore, useAIPanelOpen } from '../../editor/aiPanelStore.js';
import { PageNavigator } from './PageNavigator.js';
import type { PageNavigatorDocument } from './PageNavigator.js';
import { PresenceStack } from './PresenceStack.js';
import { CreatePageModal } from './CreatePageModal.js';
import type { LocaleFieldOption } from './LocaleField.js';
import styles from './P1EditorHeader.module.css';

export type { PageNavigatorDocument };

export const BEFORE_NAVIGATE_TIMEOUT_MS = 8000;

export interface CurrentUser {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
}

export interface SiteMenuItem {
  label: string;
  iconName?: string;
  callback: () => void;
}

export interface P1EditorHeaderProps {
  documents: PageNavigatorDocument[];
  currentDocument: PageNavigatorDocument | null;
  selectedDocumentPath?: string | null;
  currentUser?: CurrentUser;
  collaborators?: ActorPresence[];
  siteName: string;
  siteId?: string;
  dashboardUrl?: string;
  /** Custom logo image URL. When provided, replaces the default PantheonLogo. */
  logoUrl?: string;
  /** Called (and awaited) before the logo link navigates — use to flush pending saves. */
  onBeforeLogoNavigate?: () => Promise<void>;
  onSelectDocument: (doc: PageNavigatorDocument) => void;
  onCreateDocument?: (
    path: string,
    template?: TemplateSummary | null,
    title?: string,
    locale?: string,
  ) => Promise<void>;
  onGenerateWithAI?: (brief: string, page: { path: string; title: string }) => void;
  onLogout: () => void | Promise<void>;
  /**
   * Set when a logout attempt failed. Rendered in the header rather than the
   * user menu, which closes on click before the attempt resolves.
   */
  logoutError?: string | null;
  /** True while a logout is in flight; disables the menu item. */
  isLoggingOut?: boolean;
  templates?: TemplateSummary[];
  templatesLoading?: boolean;
  /** Data sources (built-in + user) for the modal's collection builder. */
  datasources?: { id: string; label: string; inputs?: string[] }[];
  /** Show the Zappy AI Assistant toggle. Pass the same flag that gates the chat plugin. */
  showAIPanelToggle?: boolean;
  /** Create a new template from the modal's "New template" flow. */
  onCreateTemplate?: (params: {
    name: string;
    label: string;
    description?: string;
    defaultUrlPattern?: string;
  }) => Promise<Template>;
  /** The site's market locales, for the create-page modal's locale field. */
  locales?: LocaleFieldOption[];
  /** The site's locales could not be read, so an empty `locales` means unknown. */
  localesFailed?: boolean;
  /** Ask for the site's locales again. */
  onRetryLocales?: () => void;
  /** Pages the modal can start a locale version from. */
  translatablePages?: { id: string; path: string; title?: string }[];
  /** Create a locale version of an existing page, from the modal's translate flow. */
  onCreateTranslation?: (params: {
    sourceDocumentId: string;
    locale: string;
    mode: 'copy';
  }) => Promise<void>;
  /**
   * Lets the editor hand the header a request to open the create-page modal,
   * already aimed at a market and a page. Returns a function that withdraws it.
   */
  registerCreatePageOpener?: (
    open: (params?: { locale?: string; sourceDocumentId?: string }) => void,
  ) => () => void;
}

export function P1EditorHeader({
  documents,
  currentDocument,
  selectedDocumentPath,
  currentUser,
  collaborators = [],
  siteName,
  siteId,
  dashboardUrl,
  logoUrl,
  onBeforeLogoNavigate,
  onSelectDocument,
  onCreateDocument,
  onGenerateWithAI,
  onLogout,
  logoutError,
  isLoggingOut,
  templates,
  templatesLoading,
  onCreateTemplate,
  datasources,
  showAIPanelToggle = false,
  locales,
  localesFailed,
  onRetryLocales,
  translatablePages,
  onCreateTranslation,
  registerCreatePageOpener,
}: P1EditorHeaderProps): React.ReactElement {
  const aiPanelOpen = useAIPanelOpen();
  // The panel only mounts once open, so it can't reveal itself when a brief arrives.
  const handleGenerateWithAI = React.useMemo(
    () =>
      onGenerateWithAI
        ? (brief: string, page: { path: string; title: string }): void => {
            aiPanelStore.open();
            onGenerateWithAI(brief, page);
          }
        : undefined,
    [onGenerateWithAI],
  );
  const [pageNavigatorOpen, setPageNavigatorOpen] = useState(false);
  // The Create Page modal, opened from the page navigator's "+ New page" /
  // "+ New template". `createModalMode` selects which screen it opens on.
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalMode, setCreateModalMode] = useState<
    'page' | 'new-template' | 'translate'
  >('page');
  // A locale the modal opens already set on, from a control that settled it
  // before the modal existed.
  const [createModalLocale, setCreateModalLocale] = useState<string | undefined>();
  const [createModalSource, setCreateModalSource] = useState<string | undefined>();

  // The header owns the modal, so it is the header that carries out a request
  // to open it — the locale switcher asking for a market it holds no version of.
  useEffect(() => {
    if (!registerCreatePageOpener) return;
    return registerCreatePageOpener((params) => {
      // Naming a page to start from is what makes this a translation. Without
      // one there is nothing to open the translate screen on, so the modal
      // opens where a new page normally begins.
      setCreateModalMode(params?.sourceDocumentId ? 'translate' : 'page');
      setCreateModalLocale(params?.locale);
      setCreateModalSource(params?.sourceDocumentId);
      setCreateModalOpen(true);
    });
  }, [registerCreatePageOpener]);
  const [navigatorPortalStyle, setNavigatorPortalStyle] = useState<
    React.CSSProperties | undefined
  >();
  const pageSelectorRef = useRef<HTMLButtonElement>(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userMenuStyle, setUserMenuStyle] = useState<React.CSSProperties>({});
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [logoImgError, setLogoImgError] = useState(false);
  useEffect(() => { setLogoImgError(false); }, [logoUrl]);

  const handlePageSelectorClick = useCallback(() => {
    setUserMenuOpen(false);
    if (!pageNavigatorOpen && pageSelectorRef.current) {
      const rect = pageSelectorRef.current.getBoundingClientRect();
      const isMobile = window.innerWidth < 768;
      setNavigatorPortalStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: isMobile ? 0 : Math.max(rect.left - 100, 8),
        width: isMobile ? window.innerWidth : Math.min(560, window.innerWidth - 16),
        zIndex: 9999,
      });
    }
    setPageNavigatorOpen((o) => !o);
  }, [pageNavigatorOpen]);

  const handleUserMenuClick = useCallback(() => {
    setPageNavigatorOpen(false);
    if (!userMenuOpen && userMenuTriggerRef.current) {
      const rect = userMenuTriggerRef.current.getBoundingClientRect();
      setUserMenuStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
        maxWidth: Math.min(280, window.innerWidth - 16),
        zIndex: 9999,
      });
    }
    setUserMenuOpen((prev) => !prev);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!pageNavigatorOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (pageSelectorRef.current?.contains(target)) return;
      const navigatorEl = document.querySelector('[role="dialog"][aria-label="Page navigator"]');
      if (navigatorEl?.contains(target)) return;
      setPageNavigatorOpen(false);
    }
    document.addEventListener('pointerdown', handleClickOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', handleClickOutside, { capture: true });
  }, [pageNavigatorOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (userMenuTriggerRef.current?.contains(target) || userMenuRef.current?.contains(target)) {
        return;
      }
      setUserMenuOpen(false);
    }
    document.addEventListener('pointerdown', handleClickOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', handleClickOutside, { capture: true });
  }, [userMenuOpen]);

  function handleSelectDocument(doc: PageNavigatorDocument): void {
    onSelectDocument(doc);
    setPageNavigatorOpen(false);
  }

  // CreatePageModal emits a bare path + title (+ a content-type template id when
  // creating from a "Page type template"). Normalize to a leading slash and
  // resolve the template id to its list entry so the provider scaffolds from
  // the template and binds templateId/version.
  const handleModalCreateDocument = useCallback(
    async (
      path: string,
      title: string,
      templateId?: string,
      locale?: string,
    ): Promise<void> => {
      if (!onCreateDocument) return;
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const template = templateId
        ? (templates?.find((t) => t.id === templateId) ?? null)
        : undefined;
      await onCreateDocument(normalizedPath, template, title, locale);
    },
    [onCreateDocument, templates],
  );

  // Build dashboard URL if siteId is provided
  const dashboardHref = React.useMemo(() => {
    if (!siteId) return undefined;
    const baseUrl = (dashboardUrl || 'https://content.pantheon.io').replace(/\/$/, '');
    return `${baseUrl}/dashboard/sites/${siteId}`;
  }, [siteId, dashboardUrl]);


  const [logoNavSaving, setLogoNavSaving] = useState(false);
  const logoNavTimerRef = useRef<number | undefined>(undefined);

  const logoNavMountedRef = useRef(true);

  useEffect(() => {
    logoNavMountedRef.current = true;
    return () => {
      logoNavMountedRef.current = false;
      window.clearTimeout(logoNavTimerRef.current);
    };
  }, []);

  const handleLogoClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!dashboardHref) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (logoNavSaving) return;
      const navigate = () => {
        if (!logoNavMountedRef.current) return;
        window.location.href = dashboardHref;
      };
      if (!onBeforeLogoNavigate) {
        navigate();
        return;
      }
      let settled = false;
      const settle = () => {
        settled = true;
        window.clearTimeout(logoNavTimerRef.current);
        setLogoNavSaving(false);
      };
      const confirmLeave = () => {
        if (!logoNavMountedRef.current) return;
        const leave = window.confirm(
          'Save failed — your latest changes couldn’t be saved. Leave anyway?',
        );
        if (leave) navigate();
      };
      setLogoNavSaving(true);
      logoNavTimerRef.current = window.setTimeout(() => {
        if (settled) return;
        settle();
        confirmLeave();
      }, BEFORE_NAVIGATE_TIMEOUT_MS);
      onBeforeLogoNavigate()
        .then(() => {
          if (settled) return;
          settle();
          navigate();
        })
        .catch((err: unknown) => {
          if (settled) return;
          settle();
          console.error('[P1EditorHeader] Pre-navigation save failed:', err);
          confirmLeave();
        });
    },
    [onBeforeLogoNavigate, dashboardHref, logoNavSaving],
  );

  return (
    <header data-testid="p1-editor-header" className={styles.header}>
      {/* The user menu closes as soon as Log out is clicked, so both the
          in-flight and the failed state have to surface out here instead. */}
      {isLoggingOut && (
        <p role="status" data-testid="logout-pending" className={styles.logoutStatus}>
          Signing you out…
        </p>
      )}
      {!isLoggingOut && logoutError && (
        <p role="alert" data-testid="logout-error" className={styles.logoutStatus} data-variant="error">
          You are still signed in — {logoutError}
        </p>
      )}
      {/* Branding */}
      <a
        href={dashboardHref}
        className={
          logoNavSaving ? `${styles.logoLink} ${styles.logoLinkSaving}` : styles.logoLink
        }
        title={dashboardHref ? 'Go to P1 Dashboard' : undefined}
        data-testid="p1-logo-link"
        aria-busy={logoNavSaving || undefined}
        aria-disabled={logoNavSaving || undefined}
        onClick={handleLogoClick}
      >
        {logoUrl && !logoImgError ? (
          <img
            src={logoUrl}
            alt="Pantheon P1"
            data-testid="p1-logo"
            className={styles.logo}
            onError={() => setLogoImgError(true)}
          />
        ) : (
          // PDS dropped sub-brand support, so the bolt and the "P1" wordmark
          // are composed here instead of via the removed `subBrand` prop.
          <span className={styles.logoLockup}>
            <PantheonLogo
              data-testid="p1-logo"
              className={styles.logo}
              displayType="icon"
              size="s"
              linkContent={null}
            />
            <span className={styles.subBrand}>P1</span>
          </span>
        )}
      </a>
      <div className={styles.divider} aria-hidden="true" />
      {/* Site label — visual only, dropdown not yet supported */}
      <div data-testid="site-label" className={styles.siteLabel}>
        <Icon iconName="globe" size="xs" aria-hidden="true" />
        <span className="visually-hidden">Site: {siteName}</span>
        <span className={styles.siteName} aria-hidden="true">
          {siteName}
        </span>
      </div>
      <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>

      {/* Page selector button group */}
      <div className={styles.pageSelectorGroup}>
        <button
          ref={pageSelectorRef}
          data-testid="page-selector"
          className={styles.pageSelector}
          onClick={handlePageSelectorClick}
          type="button"
          aria-haspopup="true"
          aria-expanded={pageNavigatorOpen}
        >
          <Icon iconName="folderTree" size="xs" aria-hidden="true" />
          <span className={styles.labelText}>
            {currentDocument?.path || selectedDocumentPath || 'Select a page'}
            <Icon iconName="angleDown" size="xs" aria-hidden="true" />
          </span>
        </button>

        {/* Open in new tab button — shown when editing a publicly viewable page */}
        {(() => {
          const pagePath = currentDocument?.path || selectedDocumentPath;
          // Templates (edited at _registry/templates/<name>) aren't publicly
          // published, so there's no page to view — hide the button for them.
          const isTemplatePath =
            typeof pagePath === 'string' && /^\/?_registry\/templates\//.test(pagePath);
          // Show for any real page path, including the home page ("/").
          const shouldShow = !!pagePath && !isTemplatePath;
          return shouldShow ? (
            <a
              href={pagePath}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLinkButton}
              title="Open page in new tab"
              data-testid="open-external"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" x2="21" y1="14" y2="3" />
              </svg>
            </a>
          ) : null;
        })()}
      </div>

      {/* Page navigator — portal-rendered with pre-computed position to avoid flash.
          Its "+ New page" opens the Create Page modal. */}
      <PageNavigator
        open={pageNavigatorOpen}
        documents={documents}
        currentDocument={currentDocument}
        isMainBranch={true}
        onSelect={handleSelectDocument}
        onCreateDocument={onCreateDocument}
        onCreatePage={() => {
          setPageNavigatorOpen(false);
          setCreateModalMode('page');
          setCreateModalLocale(undefined);
          setCreateModalSource(undefined);
          setCreateModalOpen(true);
        }}
        onCreateTemplate={() => {
          setPageNavigatorOpen(false);
          setCreateModalMode('new-template');
          setCreateModalLocale(undefined);
          setCreateModalSource(undefined);
          setCreateModalOpen(true);
        }}
        templates={templates}
        templatesLoading={templatesLoading}
        onClose={() => setPageNavigatorOpen(false)}
        portalStyle={navigatorPortalStyle}
      />

      {/* Create page modal — opened from the temporary trigger above. */}
      <CreatePageModal
        open={createModalOpen}
        initialMode={createModalMode}
        initialLocale={createModalLocale}
        initialSourceDocumentId={createModalSource}
        onClose={() => setCreateModalOpen(false)}
        onCreateDocument={handleModalCreateDocument}
        locales={locales}
        localesFailed={localesFailed}
        onRetryLocales={onRetryLocales}
        translatablePages={translatablePages}
        onCreateTranslation={onCreateTranslation}
        onGenerateWithAI={handleGenerateWithAI}
        templates={templates}
        onCreateTemplate={onCreateTemplate}
        datasources={datasources}
        onNavigate={(path) => {
          const normalizedPath = path.startsWith('/') ? path : `/${path}`;
          onSelectDocument({ id: normalizedPath, path: normalizedPath, archived: false });
        }}
      />

      {/* Spacer */}
      <div className={styles.spacer} />
      {collaborators.length > 0 && (
        <>
          <div className={styles.collaborators} data-testid="header-collaborators">
            <PresenceStack actors={collaborators} maxVisible={3} showActiveDot />
          </div>
          <div
            className={styles.divider}
            data-testid="header-collaborators-divider"
            aria-hidden="true"
          />
        </>
      )}

      {/* Zappy */}
      {showAIPanelToggle && (
        <>
          <button
            type="button"
            data-testid="ai-panel-toggle"
            className={
              aiPanelOpen ? `${styles.aiToggle} ${styles.aiToggleActive}` : styles.aiToggle
            }
            onClick={() => aiPanelStore.toggle()}
            aria-pressed={aiPanelOpen}
            aria-label="Zappy AI Assistant"
          >
            <Icon iconName="sparkles" size="m" />
          </button>
          <div className={styles.divider} aria-hidden="true" />
        </>
      )}

      {/* User avatar + account menu */}
      <button
        ref={userMenuTriggerRef}
        data-testid="user-menu-trigger"
        type="button"
        className={styles.userAvatar}
        onClick={handleUserMenuClick}
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        aria-label="Account menu"
      >
        {currentUser?.avatar ? (
          <div className="pds-avatar pds-avatar--md pds-avatar--image">
            <span className="pds-avatar__content">
              <img
                alt=""
                className="pds-avatar__image"
                src={currentUser.avatar}
                referrerPolicy="no-referrer"
              />
            </span>
          </div>
        ) : (
          <Avatar
            uniqueId={currentUser?.id}
            hasUserFallback
            size="m"
          />
        )}
      </button>

      {userMenuOpen &&
        createPortal(
          <div
            ref={userMenuRef}
            data-testid="user-menu"
            className={styles.dropdownMenu}
            role="menu"
            style={userMenuStyle}
          >
            {currentUser?.name && (
              <div className={styles.dropdownUserInfo} role="presentation">
                {currentUser.name}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              data-testid="user-menu-logout"
              className={styles.dropdownMenuItem}
              disabled={isLoggingOut}
              aria-busy={isLoggingOut}
              onClick={() => {
                if (isLoggingOut) return;
                setUserMenuOpen(false);
                onLogout();
              }}
            >
              <Icon iconName="bracketRight" size="xs" aria-hidden="true" />
              {isLoggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>,
          document.body
        )}
    </header>
  );
}
