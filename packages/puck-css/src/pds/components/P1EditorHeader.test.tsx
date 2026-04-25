/**
 * P1EditorHeader Tests
 *
 * Tests for the pure presentational header component — branding,
 * workstream switcher, page selector, user avatar with account menu,
 * and the "Compare with Live" button that appears only on non-main branches.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { P1EditorHeader } from './P1EditorHeader.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('./WorkstreamSwitcher.js', () => ({
  WorkstreamSwitcher: () => (
    <div data-testid="workstream-trigger" />
  ),
}));

vi.mock('./PageNavigator.js', () => ({
  PageNavigator: () => (
    <div data-testid="page-navigator" />
  ),
}));

// =============================================================================
// Types
// =============================================================================

interface Branch {
  id: string;
  name: string;
  isMain: boolean;
}

interface Document {
  id: string;
  path: string;
  archived: boolean;
  isPublished: boolean;
  inherited: boolean;
}

// =============================================================================
// Fixtures
// =============================================================================

const mainBranch: Branch = { id: 'branch-main', name: 'main', isMain: true };
const draftBranch: Branch = { id: 'branch-draft', name: 'my-feature', isMain: false };

const docHome: Document = {
  id: 'doc-home',
  path: '/home',
  archived: false,
  isPublished: true,
  inherited: false,
};

const docAbout: Document = {
  id: 'doc-about',
  path: '/about',
  archived: false,
  isPublished: false,
  inherited: false,
};

const currentUser = { id: 'user-42', avatar: 'https://example.com/photo.jpg' };

const siteMenuItems = [
  { label: 'Code view', callback: vi.fn() },
  { label: 'Site settings', callback: vi.fn() },
];

// =============================================================================
// Tests
// =============================================================================

afterEach(() => {
  cleanup();
});

describe('P1EditorHeader', () => {
  const defaultProps = {
    branches: [mainBranch, draftBranch],
    currentBranch: mainBranch,
    documents: [docHome, docAbout],
    currentDocument: docHome,
    currentUser,
    siteName: 'My Awesome Site',
    siteMenuItems,
    onSwitchBranch: vi.fn(),
    onSelectDocument: vi.fn(),
    onCompareWithLive: vi.fn(),
    onLogout: vi.fn(),
  };

  it('renders a header element with data-testid="p1-editor-header"', () => {
    render(<P1EditorHeader {...defaultProps} />);

    expect(screen.getByTestId('p1-editor-header').tagName).toBe('HEADER');
  });

  it('renders the P1 logo / branding mark', () => {
    render(<P1EditorHeader {...defaultProps} />);

    expect(screen.getByTestId('p1-logo')).toBeDefined();
  });

  it('renders the WorkstreamSwitcher', () => {
    render(<P1EditorHeader {...defaultProps} />);

    expect(screen.getByTestId('workstream-trigger')).toBeDefined();
  });

  it('renders the page selector button showing the current document path', () => {
    render(<P1EditorHeader {...defaultProps} currentDocument={docHome} />);

    const pageSelector = screen.getByTestId('page-selector');
    expect(pageSelector).toBeDefined();
    expect(pageSelector.textContent).toContain('/home');
  });

  it('renders the user menu trigger with a PDS Avatar', () => {
    render(<P1EditorHeader {...defaultProps} />);

    const trigger = screen.getByTestId('user-menu-trigger');
    expect(trigger).toBeDefined();
    expect(trigger.querySelector('.pds-avatar')).toBeTruthy();
  });

  it('renders user avatar with profile image when available', () => {
    render(<P1EditorHeader {...defaultProps} />);

    const trigger = screen.getByTestId('user-menu-trigger');
    const img = trigger.querySelector('.pds-avatar__image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/photo.jpg');
  });

  it('sets referrerPolicy="no-referrer" on the user avatar image for Google OAuth URLs', () => {
    render(<P1EditorHeader {...defaultProps} />);

    const trigger = screen.getByTestId('user-menu-trigger');
    const img = trigger.querySelector('.pds-avatar__image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('renders user avatar with fallback when no profile image', () => {
    render(<P1EditorHeader {...defaultProps} currentUser={{ id: 'user-99' }} />);

    const trigger = screen.getByTestId('user-menu-trigger');
    expect(trigger.querySelector('.pds-avatar__user-icon')).toBeTruthy();
  });

  it('does NOT render "Compare with Live" button when current branch is main', () => {
    render(<P1EditorHeader {...defaultProps} currentBranch={mainBranch} />);

    expect(screen.queryByTestId('compare-with-live')).toBeNull();
  });

  it('renders "Compare with Live" button when current branch is not main', () => {
    render(<P1EditorHeader {...defaultProps} currentBranch={draftBranch} />);

    expect(screen.getByTestId('compare-with-live')).toBeDefined();
  });

  it('page selector shows path of null current document gracefully', () => {
    render(<P1EditorHeader {...defaultProps} currentDocument={null} />);

    expect(screen.getByTestId('page-selector')).toBeDefined();
  });

  it('opens account menu when avatar is clicked', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu')).toBeTruthy();
    });
  });

  it('account menu contains a "Log out" option', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu-logout')).toBeTruthy();
      expect(screen.getByTestId('user-menu-logout').textContent).toContain('Log out');
    });
  });

  it('calls onLogout when "Log out" is clicked', async () => {
    const onLogout = vi.fn();
    render(<P1EditorHeader {...defaultProps} onLogout={onLogout} />);

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu-logout')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('user-menu-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('closes menu after "Log out" is clicked', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('user-menu-logout'));
    expect(screen.queryByTestId('user-menu')).toBeNull();
  });

  // ── Site selector ───────────────────────────────────────────────────

  it('renders the site selector showing the site name', () => {
    render(<P1EditorHeader {...defaultProps} siteName="My Awesome Site" />);

    const siteSelector = screen.getByTestId('site-selector');
    expect(siteSelector).toBeDefined();
    expect(siteSelector.textContent).toContain('My Awesome Site');
  });

  it('site selector is a button with aria-haspopup="menu"', () => {
    render(<P1EditorHeader {...defaultProps} />);

    const btn = screen.getByTestId('site-selector');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('site selector appears between logo and workstream switcher in the header', () => {
    render(<P1EditorHeader {...defaultProps} />);

    const header = screen.getByTestId('p1-editor-header');
    const children = Array.from(header.children);
    const logoIdx = children.findIndex(
      (el) => (el as HTMLElement).dataset.testid === 'p1-logo',
    );
    const siteIdx = children.findIndex(
      (el) => (el as HTMLElement).dataset.testid === 'site-selector',
    );
    const workstreamIdx = children.findIndex(
      (el) =>
        (el as HTMLElement).dataset.testid === 'workstream-trigger' ||
        el.querySelector('[data-testid="workstream-trigger"]') !== null,
    );
    expect(logoIdx).toBeLessThan(siteIdx);
    expect(siteIdx).toBeLessThan(workstreamIdx);
  });

  it('opens site menu when site selector is clicked', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('site-selector'));
    await waitFor(() => {
      expect(screen.getByTestId('site-menu')).toBeTruthy();
    });
  });

  it('site menu displays all menu items', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('site-selector'));
    await waitFor(() => {
      const menu = screen.getByTestId('site-menu');
      const items = menu.querySelectorAll('[role="menuitem"]');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toContain('Code view');
      expect(items[1].textContent).toContain('Site settings');
    });
  });

  it('calls menu item callback and closes menu when an item is clicked', async () => {
    const codeViewCb = vi.fn();
    const items = [
      { label: 'Code view', callback: codeViewCb },
      { label: 'Site settings', callback: vi.fn() },
    ];
    render(<P1EditorHeader {...defaultProps} siteMenuItems={items} />);

    fireEvent.click(screen.getByTestId('site-selector'));
    await waitFor(() => {
      expect(screen.getByTestId('site-menu')).toBeTruthy();
    });
    const menuItems = screen.getByTestId('site-menu').querySelectorAll('[role="menuitem"]');
    fireEvent.click(menuItems[0]);
    expect(codeViewCb).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('site-menu')).toBeNull();
  });

  // ── Mutual exclusion ─────────────────────────────────────────────────

  it('opening site menu closes an open user menu', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('site-selector'));
    await waitFor(() => {
      expect(screen.getByTestId('site-menu')).toBeTruthy();
    });
    expect(screen.queryByTestId('user-menu')).toBeNull();
  });

  it('opening user menu closes an open site menu', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('site-selector'));
    await waitFor(() => {
      expect(screen.getByTestId('site-menu')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu')).toBeTruthy();
    });
    expect(screen.queryByTestId('site-menu')).toBeNull();
  });

  it('opening page selector closes an open site menu', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('site-selector'));
    await waitFor(() => {
      expect(screen.getByTestId('site-menu')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('page-selector'));
    expect(screen.queryByTestId('site-menu')).toBeNull();
  });

  it('clicking branch switcher closes an open page navigator', () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('page-selector'));
    expect(screen.getByTestId('page-selector').getAttribute('aria-expanded')).toBe('true');

    fireEvent.pointerDown(screen.getByTestId('workstream-trigger'));
    expect(screen.getByTestId('page-selector').getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking branch switcher closes an open user menu', async () => {
    render(<P1EditorHeader {...defaultProps} />);

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    await waitFor(() => {
      expect(screen.getByTestId('user-menu')).toBeTruthy();
    });

    fireEvent.pointerDown(screen.getByTestId('workstream-trigger'));
    expect(screen.queryByTestId('user-menu')).toBeNull();
  });
});
