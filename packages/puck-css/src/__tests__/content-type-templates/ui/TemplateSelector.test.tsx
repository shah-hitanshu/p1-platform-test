/**
 * TemplateSelector Component Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TemplateSelector } from '../../../features/content-type-templates/ui/TemplateSelector.js';
import type { TemplateSummary } from '../../../features/content-type-templates/types.js';

// Mock the useTemplateList hook
vi.mock('../../../features/content-type-templates/hooks/useTemplateList.js', () => ({
  useTemplateList: vi.fn(),
}));

import { useTemplateList } from '../../../features/content-type-templates/hooks/useTemplateList.js';

describe('TemplateSelector', () => {
  const mockTemplates: TemplateSummary[] = [
    {
      id: 'template-1',
      name: 'blog-post',
      label: 'Blog Post',
      description: 'Standard blog post layout',
      defaultUrlPattern: '/blog/:slug',
      version: 1,
      updatedAt: '2026-06-08T00:00:00Z',
    },
    {
      id: 'template-2',
      name: 'landing-page',
      label: 'Landing Page',
      description: 'Marketing landing page',
      defaultUrlPattern: '/landing/:slug',
      version: 2,
      updatedAt: '2026-06-08T00:00:00Z',
    },
  ];

  const mockClient = {} as P1Client;
  const mockOnSelect = vi.fn();

  it('should render loading state while fetching templates', () => {
    vi.mocked(useTemplateList).mockReturnValue({
      templates: [],
      loading: true,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('should render template list with labels and descriptions', async () => {
    vi.mocked(useTemplateList).mockReturnValue({
      templates: mockTemplates,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blog Post')).toBeInTheDocument();
    });

    expect(screen.getByText('Blog Post')).toBeInTheDocument();
    expect(screen.getByText('Standard blog post layout')).toBeInTheDocument();
    expect(screen.getByText('Landing Page')).toBeInTheDocument();
    expect(screen.getByText('Marketing landing page')).toBeInTheDocument();
  });

  it('should include "Blank Page" option', async () => {
    vi.mocked(useTemplateList).mockReturnValue({
      templates: mockTemplates,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blank Page')).toBeInTheDocument();
    });

    expect(screen.getByText('Blank Page')).toBeInTheDocument();
    expect(screen.getByText(/start from scratch/i)).toBeInTheDocument();
  });

  it('should call onSelect when template clicked', async () => {
    vi.mocked(useTemplateList).mockReturnValue({
      templates: mockTemplates,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blog Post')).toBeInTheDocument();
    });

    const blogTemplate = screen.getByText('Blog Post').closest('button');
    if (!blogTemplate) throw new Error('Blog Post button not found');
    fireEvent.click(blogTemplate);

    expect(mockOnSelect).toHaveBeenCalledWith(mockTemplates[0]);
  });

  it('should call onSelect with null when "Blank Page" clicked', async () => {
    vi.mocked(useTemplateList).mockReturnValue({
      templates: mockTemplates,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blank Page')).toBeInTheDocument();
    });

    const blankOption = screen.getByText('Blank Page').closest('button');
    if (!blankOption) throw new Error('Blank Page button not found');
    fireEvent.click(blankOption);

    expect(mockOnSelect).toHaveBeenCalledWith(null);
  });

  it('should show error state on fetch failure', () => {
    const mockError = new Error('Failed to fetch templates');

    vi.mocked(useTemplateList).mockReturnValue({
      templates: [],
      loading: false,
      error: mockError,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByText(/error/i)).toBeInTheDocument();
    expect(screen.getByText(/failed to fetch templates/i)).toBeInTheDocument();
  });

  it('should highlight selected template', async () => {
    vi.mocked(useTemplateList).mockReturnValue({
      templates: mockTemplates,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <TemplateSelector
        client={mockClient}
        siteId="site-1"
        branchId="branch-1"
        onSelect={mockOnSelect}
        selectedTemplateId="template-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blog Post')).toBeInTheDocument();
    });

    const blogTemplateButton = screen.getByText('Blog Post').closest('button');
    expect(blogTemplateButton).toHaveAttribute('aria-pressed', 'true');

    const landingTemplateButton = screen.getByText('Landing Page').closest('button');
    expect(landingTemplateButton).toHaveAttribute('aria-pressed', 'false');
  });
});
