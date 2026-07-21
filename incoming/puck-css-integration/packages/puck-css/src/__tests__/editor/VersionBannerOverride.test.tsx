import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

let mockCurrentDocument: unknown = null;

vi.mock('../../core/P1PuckContext', () => ({
  useP1Puck: () => ({
    currentDocument: mockCurrentDocument,
  }),
}));

import { VersionBannerOverride } from '../../editor/components/VersionBannerOverride';

const v1: DocumentVersion = {
  id: 'v-latest',
  documentId: 'd1',
  versionNumber: 3,
  snapshot: {},
  createdAt: new Date().toISOString(),
  createdBy: 'user-1',
};

const v2: DocumentVersion = {
  id: 'v-old',
  documentId: 'd1',
  versionNumber: 2,
  snapshot: {},
  createdAt: new Date('2024-06-01').toISOString(),
  createdBy: 'user-1',
};

describe('VersionBannerOverride', () => {
  beforeEach(() => {
    mockCurrentDocument = { id: 'd1', path: '/home' };
  });

  it('renders children', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]}>
        <div>child content</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('does not show warning banner when no version is selected', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByText('Viewing a previous version')).not.toBeInTheDocument();
  });

  it('does not show warning banner when viewing the latest version', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]} selectedVersionId="v-latest">
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByText('Viewing a previous version')).not.toBeInTheDocument();
  });

  it('shows warning banner when viewing an old version', () => {
    render(
      <VersionBannerOverride versions={[v1, v2]} selectedVersionId="v-old">
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText('Viewing a previous version')).toBeInTheDocument();
  });

  it('"Return to current" button calls onVersionSelect with the latest version', () => {
    const onVersionSelect = vi.fn();
    render(
      <VersionBannerOverride
        versions={[v1, v2]}
        selectedVersionId="v-old"
        onVersionSelect={onVersionSelect}
      >
        <div>child</div>
      </VersionBannerOverride>,
    );
    fireEvent.click(screen.getByRole('button', { name: /return to current/i }));
    expect(onVersionSelect).toHaveBeenCalledWith(v1);
  });

  it('shows "Choose a page" overlay when currentDocument is null', () => {
    mockCurrentDocument = null;
    render(
      <VersionBannerOverride versions={[]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText('Choose a page from the menu above')).toBeInTheDocument();
  });

  it('hides "Choose a page" overlay when currentDocument is set', () => {
    mockCurrentDocument = { id: 'd1', path: '/home' };
    render(
      <VersionBannerOverride versions={[]}>
        <div>child</div>
      </VersionBannerOverride>,
    );
    expect(screen.queryByText('Choose a page from the menu above')).not.toBeInTheDocument();
  });
});
