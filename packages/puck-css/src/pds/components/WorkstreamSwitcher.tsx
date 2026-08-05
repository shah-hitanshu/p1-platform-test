/**
 * WorkstreamSwitcher component.
 *
 * Displays the current branch in a trigger button and opens a dropdown that
 * lists all branches, supports search filtering, exposes a "Compare with
 * Live" action when the viewer is not on the main branch, and provides an
 * inline "New workstream" create form in the footer.
 *
 * The dropdown uses createPortal + position:fixed so it escapes any
 * overflow:hidden or z-index constraints on ancestor elements (e.g. Puck's
 * header container or sidebar panels).
 */

import React, { useState, useRef, useEffect, useCallback, useTransition } from 'react';
import { createPortal } from 'react-dom';
import type { Branch } from '@pantheon-systems/css-client';
import { Icon, Button, StatusIndicator } from '@pantheon-systems/pds-toolkit-react';
import styles from './WorkstreamSwitcher.module.css';

export interface WorkstreamSwitcherProps {
  branches: Branch[];
  currentBranch: Branch | null;
  onSwitch: (branchId: string) => void;
  onCompareWithLive: () => void;
  /** Set to true when the parent already renders its own Compare button */
  hideCompareButton?: boolean;
  /** Called when the user creates a new workstream branch. */
  onCreateBranch?: (name: string) => Promise<void>;
}

export function WorkstreamSwitcher({
  branches,
  currentBranch,
  onSwitch,
  onCompareWithLive,
  hideCompareButton = false,
  onCreateBranch,
}: WorkstreamSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Use transition to keep old UI visible while switching branches
  const [isPending, startTransition] = useTransition();

  const triggerLabel = currentBranch?.isMain ? 'Live' : (currentBranch?.name ?? 'Select branch');
  const isOnMain = currentBranch?.isMain ?? false;

  const matched = query
    ? branches.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
    : branches;

  // Main branch ("Live") always sorts to the top
  const filtered = [...matched].sort((a, b) => {
    if (a.isMain) return -1;
    if (b.isMain) return 1;
    return 0;
  });

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setDropdownStyle({
          position: 'fixed',
          top: rect.bottom + 6,
          left: 0,
          width: window.innerWidth,
          zIndex: 9999,
        });
      } else {
        const availableWidth = window.innerWidth - 16;
        setDropdownStyle({
          position: 'fixed',
          top: rect.bottom + 6,
          left: Math.min(rect.left, window.innerWidth - Math.min(400, availableWidth) - 8),
          width: Math.min(Math.max(rect.width, 280), availableWidth),
          zIndex: 9999,
        });
      }
    }
  }, []);

  function closeDropdown(): void {
    setOpen(false);
    setIsCreating(false);
    setNewName('');
    setCreateError(null);
  }

  function handleTrigger(): void {
    if (!open) {
      updatePosition();
      setOpen(true);
    } else {
      closeDropdown();
    }
  }

  function handleBranchClick(branch: Branch): void {
    if (currentBranch && branch.id === currentBranch.id) return;

    // Wrap the branch switch in a transition to keep old UI visible
    startTransition(() => {
      onSwitch(branch.id);
    });

    closeDropdown();
  }

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim() || !onCreateBranch) return;
      setCreateError(null);
      try {
        await onCreateBranch(newName.trim());
        setNewName('');
        setIsCreating(false);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Failed to create workstream');
      }
    },
    [newName, onCreateBranch],
  );

  // Close on outside click.
  //
  // Uses pointerdown with { capture: true } so the handler runs early in the
  // event lifecycle. If the click target is inside the trigger button OR inside
  // the portal dropdown (dropdownRef), we skip closing — this lets branch
  // buttons inside the portal fire their onClick before the dropdown unmounts.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return; // click is inside trigger or dropdown — don't close
      }
      closeDropdown();
    }
    document.addEventListener('pointerdown', handleClickOutside, { capture: true });
    return () => document.removeEventListener('pointerdown', handleClickOutside, { capture: true });
  }, [open]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="workstream-trigger"
        className={`${styles.trigger}${open ? ` ${styles.triggerOpen}` : ''}${isPending ? ` ${styles.triggerLoading}` : ''}`}
        onClick={handleTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={isPending}
      >
        <Icon iconName="codeBranch" size="s" aria-hidden="true" />
        <span className={styles.labelText}>
          {isPending ? 'Switching...' : triggerLabel}
          {isPending ? (
            <Icon iconName="spinner" size="s" aria-hidden="true" />
          ) : (
            <Icon iconName="angleDown" size="s" aria-hidden="true" />
          )}
        </span>
      </button>

      {!isOnMain && !hideCompareButton && (
        <Button
          data-testid="compare-with-live"
          label="Compare with Live"
          variant="secondary"
          size="sm"
          onClick={onCompareWithLive}
          buttonType="button"
        />
      )}

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            data-testid="workstream-dropdown"
            className={styles.dropdown}
            role="listbox"
            style={dropdownStyle}
          >
            <div className={styles.header}>
              <input
                autoFocus
                type="text"
                data-testid="workstream-search"
                className={styles.search}
                placeholder="Search workstreams…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                data-testid="workstream-close"
                className={styles.closeButton}
                onClick={closeDropdown}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <ul data-testid="workstream-list" className={styles.list}>
              {filtered.map((branch) => (
                <li key={branch.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.branchButton}
                    onClick={() => handleBranchClick(branch)}
                    aria-selected={
                      currentBranch ? branch.id === currentBranch.id : false
                    }
                  >
                    {branch.isMain ? (
                      <StatusIndicator
                        data-testid="workstream-live-label"
                        type="discovery"
                        label="Live"
                        size="s"
                        className={styles.liveIndicator}
                      />
                    ) : (
                      branch.name
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <div className={styles.footer}>
              {isCreating ? (
                <form
                  data-testid="workstream-create-form"
                  className={styles.createForm}
                  onSubmit={handleCreate}
                >
                  <input
                    autoFocus
                    type="text"
                    data-testid="workstream-create-input"
                    className={styles.createInput}
                    placeholder="workstream-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <div className={styles.createActions}>
                    <button type="submit" className={styles.createSubmit}>
                      Create
                    </button>
                    <button
                      type="button"
                      data-testid="workstream-create-cancel"
                      className={styles.createCancel}
                      onClick={() => { setIsCreating(false); setNewName(''); setCreateError(null); }}
                    >
                      Cancel
                    </button>
                  </div>
                  {createError && (
                    <div data-testid="workstream-create-error" className={styles.createError}>
                      {createError}
                    </div>
                  )}
                </form>
              ) : (
                <button
                  type="button"
                  data-testid="workstream-new"
                  className={styles.newButton}
                  onClick={onCreateBranch ? () => setIsCreating(true) : undefined}
                >
                  + New workstream
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
