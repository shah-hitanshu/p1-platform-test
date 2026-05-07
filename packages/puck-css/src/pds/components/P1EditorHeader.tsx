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
import type { Branch } from '@pantheon-systems/css-client';
import { Icon, Button, Avatar, PantheonLogo } from '@pantheon-systems/pds-toolkit-react';
import { getAvatarStyleOverride } from '../../collaboration/utils/avatarColor.js';
import { WorkstreamSwitcher } from './WorkstreamSwitcher.js';
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
  branches: Branch[];
  currentBranch: Branch | null;
  documents: PageNavigatorDocument[];
  currentDocument: PageNavigatorDocument | null;
  currentUser?: CurrentUser;
  siteName: string;
  siteMenuItems: SiteMenuItem[];
  onSwitchBranch: (id: string) => void;
  onSelectDocument: (doc: PageNavigatorDocument) => void;
  onCreateDocument?: (path: string) => Promise<void>;
  onCreateBranch?: (name: string) => Promise<void>;
  onCompareWithLive: () => void;
  onLogout: () => void;
}

export function P1EditorHeader({
  branches,
  currentBranch,
  documents,
  currentDocument,
  currentUser,
  siteName,
  siteMenuItems,
  onCreateBranch,
  onSwitchBranch,
  onSelectDocument,
  onCreateDocument,
  onCompareWithLive,
  onLogout,
}: P1EditorHeaderProps): React.ReactElement {
  const [pageNavigatorOpen, setPageNavigatorOpen] = useState(false);
  const [navigatorPortalStyle, setNavigatorPortalStyle] = useState<
    React.CSSProperties | undefined
  >();
  const pageSelectorRef = useRef<HTMLButtonElement>(null);

  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [siteMenuStyle, setSiteMenuStyle] = useState<React.CSSProperties>({});
  const siteMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const siteMenuDropdownRef = useRef<HTMLDivElement>(null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userMenuStyle, setUserMenuStyle] = useState<React.CSSProperties>({});
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const handlePageSelectorClick = useCallback(() => {
    setSiteMenuOpen(false);
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

  const handleSiteMenuClick = useCallback(() => {
    setPageNavigatorOpen(false);
    setUserMenuOpen(false);
    if (!siteMenuOpen && siteMenuTriggerRef.current) {
      const rect = siteMenuTriggerRef.current.getBoundingClientRect();
      const menuMaxW = Math.min(280, window.innerWidth - 16);
      setSiteMenuStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - menuMaxW - 8),
        maxWidth: menuMaxW,
        zIndex: 9999,
      });
    }
    setSiteMenuOpen((prev) => !prev);
  }, [siteMenuOpen]);

  const handleUserMenuClick = useCallback(() => {
    setPageNavigatorOpen(false);
    setSiteMenuOpen(false);
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
    if (!siteMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        siteMenuTriggerRef.current?.contains(target) ||
        siteMenuDropdownRef.current?.contains(target)
      ) {
        return;
      }
      setSiteMenuOpen(false);
    }
    document.addEventListener('pointerdown', handleClickOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', handleClickOutside, { capture: true });
  }, [siteMenuOpen]);

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

  const isMain = currentBranch?.isMain ?? true;

  function handleSelectDocument(doc: PageNavigatorDocument): void {
    onSelectDocument(doc);
    setPageNavigatorOpen(false);
  }

  return (
    <header data-testid="p1-editor-header" className={styles.header}>
      {/* Branding */}
      <PantheonLogo
        data-testid="p1-logo"
        className={styles.logo}
        displayType="sub-brand"
        subBrand="P1"
        size="s"
        linkContent={null}
      />

      {/* Site selector */}
      <button
        ref={siteMenuTriggerRef}
        data-testid="site-selector"
        type="button"
        className={styles.siteSelector}
        onClick={handleSiteMenuClick}
        aria-haspopup="menu"
        aria-expanded={siteMenuOpen}
      >
        <Icon iconName="globe" iconSize="s" aria-hidden="true" />
        <span className={styles.labelText}>
          {siteName}
          <Icon iconName="angleDown" iconSize="s" aria-hidden="true" />
        </span>
      </button>

      {siteMenuOpen &&
        createPortal(
          <div
            ref={siteMenuDropdownRef}
            data-testid="site-menu"
            className={styles.dropdownMenu}
            role="menu"
            style={siteMenuStyle}
          >
            {siteMenuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={styles.dropdownMenuItem}
                onClick={() => {
                  setSiteMenuOpen(false);
                  item.callback();
                }}
              >
                {item.iconName && <Icon iconName={item.iconName} iconSize="s" aria-hidden="true" />}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}

      <div className={styles.divider} />

      {/* Workstream / branch switcher */}
      <WorkstreamSwitcher
        branches={branches}
        currentBranch={currentBranch}
        onSwitch={onSwitchBranch}
        onCreateBranch={onCreateBranch}
        onCompareWithLive={onCompareWithLive}
        hideCompareButton
      />

      {/* Page selector */}
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
          {currentDocument ? currentDocument.path : 'Select a page'}
          <Icon iconName="angleDown" iconSize="s" aria-hidden="true" />
        </span>
      </button>

      {/* Page navigator — portal-rendered with pre-computed position to avoid flash */}
      <PageNavigator
        open={pageNavigatorOpen}
        documents={documents}
        currentDocument={currentDocument}
        isMainBranch={isMain}
        onSelect={handleSelectDocument}
        onCreateDocument={onCreateDocument}
        onClose={() => setPageNavigatorOpen(false)}
        portalStyle={navigatorPortalStyle}
      />

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Compare with Live — only on non-main branches, hidden on mobile */}
      {!isMain && (
        <span className={styles.compareButton}>
          <Button
            data-testid="compare-with-live"
            label="Compare with Live"
            variant="secondary"
            size="sm"
            onClick={onCompareWithLive}
            buttonType="button"
          />
        </span>
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
