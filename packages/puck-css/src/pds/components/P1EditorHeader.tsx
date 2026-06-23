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
import { getAvatarStyleOverride } from '../../collaboration/utils/avatarColor.js';
import { PageNavigator } from './PageNavigator.js';
import type { PageNavigatorDocument } from './PageNavigator.js';
import styles from './P1EditorHeader.module.css';

export type { PageNavigatorDocument };

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
  siteName: string;
  siteId?: string;
  dashboardUrl?: string;
  onSelectDocument: (doc: PageNavigatorDocument) => void;
  onCreateDocument?: (path: string) => Promise<void>;
  onLogout: () => void;
}

export function P1EditorHeader({
  documents,
  currentDocument,
  selectedDocumentPath,
  currentUser,
  siteName,
  siteId,
  dashboardUrl,
  onSelectDocument,
  onCreateDocument,
  onLogout,
}: P1EditorHeaderProps): React.ReactElement {
  const [pageNavigatorOpen, setPageNavigatorOpen] = useState(false);
  const [navigatorPortalStyle, setNavigatorPortalStyle] = useState<
    React.CSSProperties | undefined
  >();
  const pageSelectorRef = useRef<HTMLButtonElement>(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userMenuStyle, setUserMenuStyle] = useState<React.CSSProperties>({});
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Build dashboard URL if siteId is provided
  const dashboardHref = React.useMemo(() => {
    if (!siteId) return undefined;
    const baseUrl = (dashboardUrl || 'https://content.pantheon.io').replace(/\/$/, '');
    return `${baseUrl}/dashboard/sites/${siteId}`;
  }, [siteId, dashboardUrl]);

  return (
    <header data-testid="p1-editor-header" className={styles.header}>
      {/* Branding */}
      {dashboardHref ? (
        <a
          href={dashboardHref}
          className={styles.logoLink}
          title="Go to P1 Dashboard"
          data-testid="p1-logo-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <PantheonLogo
            data-testid="p1-logo"
            className={styles.logo}
            displayType="sub-brand"
            subBrand="P1"
            size="s"
            linkContent={null}
          />
        </a>
      ) : (
        <PantheonLogo
          data-testid="p1-logo"
          className={styles.logo}
          displayType="sub-brand"
          subBrand="P1"
          size="s"
          linkContent={null}
        />
      )}

      {/* Site label */}
      <div
        data-testid="site-label"
        className={styles.siteLabel}
      >
        <span className={styles.labelText}>
          Site: {siteName}
        </span>
      </div>

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
          <Icon iconName="folderTree" iconSize="s" aria-hidden="true" />
          <span className={styles.labelText}>
            {currentDocument?.path || selectedDocumentPath || 'Select a page'}
            <Icon iconName="angleDown" iconSize="s" aria-hidden="true" />
          </span>
        </button>

        {/* Open in new tab button — shown when editing a page with a valid path */}
        {(() => {
          const pagePath = currentDocument?.path || selectedDocumentPath;
          // Show button if there's a path and it's not empty/root
          const shouldShow = pagePath && pagePath !== '/' && pagePath !== '';
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

      {/* Page navigator — portal-rendered with pre-computed position to avoid flash */}
      <PageNavigator
        open={pageNavigatorOpen}
        documents={documents}
        currentDocument={currentDocument}
        isMainBranch={true}
        onSelect={handleSelectDocument}
        onCreateDocument={onCreateDocument}
        onClose={() => setPageNavigatorOpen(false)}
        portalStyle={navigatorPortalStyle}
      />

      {/* Spacer */}
      <div className={styles.spacer} />

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
        style={currentUser ? getAvatarStyleOverride(currentUser.id) : undefined}
      >
        {currentUser?.avatar ? (
          <div className="pds-avatar pds-avatar--md pds-avatar--image">
            <span className="pds-avatar__content">
              <img
                alt=""
                className="pds-avatar__image"
                src={currentUser.avatar}
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
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
              onClick={() => {
                setUserMenuOpen(false);
                onLogout();
              }}
            >
              <Icon iconName="bracketRight" iconSize="s" aria-hidden="true" />
              Log out
            </button>
          </div>,
          document.body
        )}
    </header>
  );
}
