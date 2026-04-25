/**
 * Document Create / Delete Integration Tests
 *
 * Create flow: PageNavigator already covers all core create scenarios.
 * These tests add only complementary coverage not found there.
 *
 * Delete flow: PublishControl owns delete. Tested directly here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageNavigator } from '../pds/components/PageNavigator.js';
import { PublishControl } from '../pds/components/PublishControl.js';
import { __toastCalls } from '@pantheon-systems/pds-toolkit-react';

// =============================================================================
// Fixtures
// =============================================================================

const docHome = { id: 'doc-home', path: '/home', archived: false };

// =============================================================================
// Helpers
// =============================================================================

afterEach(() => {
  cleanup();
  __toastCalls.length = 0;
});

// =============================================================================
// Document Create — complementary coverage
// =============================================================================

describe('PageNavigator — create button without handler', () => {
  it('renders the "+ New page" button even when onCreateDocument is not provided', () => {
    render(
      <PageNavigator
        documents={[docHome]}
        currentDocument={docHome}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        open={true}
      />
    );

    expect(screen.getByTestId('page-navigator-new')).toBeDefined();
  });

  it('clicking "+ New page" does not show the create form when onCreateDocument is not provided', () => {
    render(
      <PageNavigator
        documents={[docHome]}
        currentDocument={docHome}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        open={true}
      />
    );

    fireEvent.click(screen.getByTestId('page-navigator-new'));

    expect(screen.queryByTestId('page-navigator-create-form')).toBeNull();
  });
});

// =============================================================================
// Document Delete — PublishControl
// =============================================================================

describe('PublishControl — delete page', () => {
  const baseProps = {
    docState: 'unpublished' as const,
    context: 'main' as const,
  };

  function openMoreActionsMenu() {
    const moreActionsBtn = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(moreActionsBtn);
  }

  describe('when onDeleteDocument is provided', () => {
    it('includes a "Delete page" option in the more-actions menu', () => {
      render(
        <PublishControl
          {...baseProps}
          onDeleteDocument={vi.fn()}
        />
      );

      openMoreActionsMenu();

      expect(screen.getByRole('menuitem', { name: 'Delete page' })).toBeDefined();
    });

    it('shows a toast with a "Delete" confirm button when "Delete page" is selected', () => {
      render(
        <PublishControl
          {...baseProps}
          onDeleteDocument={vi.fn()}
        />
      );

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));

      expect(__toastCalls).toHaveLength(1);
      const toastContent = __toastCalls[0]!.content as React.ReactElement;
      const { getByRole } = render(toastContent);
      expect(getByRole('button', { name: 'Delete' })).toBeDefined();
    });

    it('calls onDeleteDocument when the toast "Delete" confirm button is clicked', () => {
      const onDeleteDocument = vi.fn().mockResolvedValue(undefined);

      render(
        <PublishControl
          {...baseProps}
          onDeleteDocument={onDeleteDocument}
        />
      );

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));

      const toastContent = __toastCalls[0]!.content as React.ReactElement;
      const { getByRole } = render(toastContent);
      fireEvent.click(getByRole('button', { name: 'Delete' }));

      expect(onDeleteDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('when onDeleteDocument is not provided', () => {
    it('does not include "Delete page" in the more-actions menu', () => {
      render(
        <PublishControl
          {...baseProps}
          onPublish={vi.fn()}
        />
      );

      openMoreActionsMenu();

      expect(screen.queryByRole('menuitem', { name: 'Delete page' })).toBeNull();
    });
  });
});
