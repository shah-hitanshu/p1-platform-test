/**
 * PageNavigator Tests
 *
 * Tests for the page navigator overlay — document listing, search,
 * archived-document filtering, selection callback, active indicator,
 * and the "New page" action button.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageNavigator } from './PageNavigator.js';

// =============================================================================
// Types
// =============================================================================

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

const docArchived: Document = {
  id: 'doc-archived',
  path: '/old-page',
  archived: true,
  isPublished: false,
  inherited: false,
};

const docContact: Document = {
  id: 'doc-contact',
  path: '/contact',
  archived: false,
  isPublished: false,
  inherited: true,
};

const allDocuments: Document[] = [docHome, docAbout, docArchived, docContact];

// =============================================================================
// Tests
// =============================================================================

afterEach(() => {
  cleanup();
});

describe('PageNavigator', () => {
  const defaultProps = {
    documents: allDocuments,
    currentDocument: docHome,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    open: true,
  };

  const templatesFixture = [
    { id: 't1', name: 'blog-post', label: 'Blog Post', version: 1, components: [], updatedAt: '' },
    { id: 't2', name: 'event', label: 'Event', version: 1, components: [], updatedAt: '' },
  ];

  // Pages | Templates tabs: browse templates and open them for editing.
  it('does not show the Templates tab when there are no templates', () => {
    render(<PageNavigator {...defaultProps} />);
    expect(screen.queryByTestId('page-navigator-tab-templates')).toBeNull();
  });

  it('shows Pages and Templates tabs when templates exist', () => {
    render(<PageNavigator {...defaultProps} templates={templatesFixture} />);
    expect(screen.getByTestId('page-navigator-tab-pages')).toBeDefined();
    expect(screen.getByTestId('page-navigator-tab-templates')).toBeDefined();
  });

  it('defaults to the Pages tab (documents listed, no template rows)', () => {
    render(<PageNavigator {...defaultProps} templates={templatesFixture} />);
    expect(screen.getAllByTestId('page-navigator-item').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('page-navigator-template-item')).toBeNull();
  });

  it('lists templates on the Templates tab', () => {
    render(<PageNavigator {...defaultProps} templates={templatesFixture} />);
    fireEvent.click(screen.getByTestId('page-navigator-tab-templates'));

    const items = screen.getAllByTestId('page-navigator-template-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Blog Post');
    // Page rows are hidden while on the Templates tab.
    expect(screen.queryByTestId('page-navigator-item')).toBeNull();
  });

  it('selects a template by its _registry path for editing', () => {
    const onSelect = vi.fn();
    render(
      <PageNavigator {...defaultProps} onSelect={onSelect} templates={templatesFixture} />,
    );
    fireEvent.click(screen.getByTestId('page-navigator-tab-templates'));
    fireEvent.click(screen.getAllByTestId('page-navigator-template-item')[0]);

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '_registry/templates/blog-post' }),
    );
  });

  it('shows a "+ New template" button on the Templates tab and calls onCreateTemplate', () => {
    const onCreateTemplate = vi.fn();
    render(
      <PageNavigator
        {...defaultProps}
        templates={templatesFixture}
        onCreateTemplate={onCreateTemplate}
      />,
    );
    fireEvent.click(screen.getByTestId('page-navigator-tab-templates'));

    const btn = screen.getByTestId('page-navigator-new-template');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onCreateTemplate).toHaveBeenCalledTimes(1);
  });

  it('does not show the "+ New template" button on the Pages tab', () => {
    render(
      <PageNavigator
        {...defaultProps}
        templates={templatesFixture}
        onCreateTemplate={vi.fn()}
      />,
    );
    // Default tab is Pages.
    expect(screen.queryByTestId('page-navigator-new-template')).toBeNull();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <PageNavigator {...defaultProps} open={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the search input when open is true', () => {
    render(<PageNavigator {...defaultProps} />);

    expect(screen.getByTestId('page-navigator-search')).toBeDefined();
  });

  it('lists each non-archived document path', () => {
    render(<PageNavigator {...defaultProps} />);

    const items = screen.getAllByTestId('page-navigator-item');
    const paths = items.map((el) => el.textContent);

    expect(paths).toContain('/home');
    expect(paths).toContain('/about');
    expect(paths).toContain('/contact');
  });

  it('does not list archived documents', () => {
    render(<PageNavigator {...defaultProps} />);

    const items = screen.getAllByTestId('page-navigator-item');
    const paths = items.map((el) => el.textContent);

    expect(paths).not.toContain('/old-page');
  });

  it('calls onSelect with the clicked document', () => {
    const onSelect = vi.fn();
    render(<PageNavigator {...defaultProps} onSelect={onSelect} />);

    const items = screen.getAllByTestId('page-navigator-item');
    const aboutItem = items.find((el) => el.textContent?.includes('/about'));
    expect(aboutItem).toBeDefined();

    fireEvent.click(aboutItem as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(docAbout);
  });

  it('marks the currently active document with aria-current="page"', () => {
    render(<PageNavigator {...defaultProps} currentDocument={docHome} />);

    const items = screen.getAllByTestId('page-navigator-item');
    const activeItem = items.find((el) => el.textContent?.includes('/home'));
    expect(activeItem).toBeDefined();
    expect((activeItem as HTMLElement).getAttribute('aria-current')).toBe('page');
  });

  it('does not mark non-active documents with aria-current', () => {
    render(<PageNavigator {...defaultProps} currentDocument={docHome} />);

    const items = screen.getAllByTestId('page-navigator-item');
    const nonActiveItem = items.find((el) => el.textContent?.includes('/about'));
    expect(nonActiveItem).toBeDefined();
    expect((nonActiveItem as HTMLElement).getAttribute('aria-current')).not.toBe('page');
  });

  it('renders the "New page" button', () => {
    render(<PageNavigator {...defaultProps} />);

    expect(screen.getByTestId('page-navigator-new')).toBeDefined();
  });

  it('renders items for every non-archived document, regardless of isPublished or inherited', () => {
    render(<PageNavigator {...defaultProps} />);

    const items = screen.getAllByTestId('page-navigator-item');
    // docHome, docAbout, docContact are non-archived (3 items, docArchived excluded)
    expect(items.length).toBe(3);
  });

  describe('inherited (live-only) document styling', () => {
    it('marks inherited docs with data-inherited="true" when not on the main branch', () => {
      render(<PageNavigator {...defaultProps} isMainBranch={false} />);

      const items = screen.getAllByTestId('page-navigator-item');
      const contactItem = items.find((el) => el.textContent?.includes('/contact'));
      expect(contactItem).toBeDefined();
      expect((contactItem as HTMLElement).getAttribute('data-inherited')).toBe('true');
    });

    it('does not mark non-inherited docs with data-inherited on a non-main branch', () => {
      render(<PageNavigator {...defaultProps} isMainBranch={false} />);

      const items = screen.getAllByTestId('page-navigator-item');
      const homeItem = items.find((el) => el.textContent?.includes('/home'));
      expect(homeItem).toBeDefined();
      expect((homeItem as HTMLElement).getAttribute('data-inherited')).toBeNull();
    });

    it('does not mark inherited docs with data-inherited when on the main branch', () => {
      render(<PageNavigator {...defaultProps} isMainBranch={true} />);

      const items = screen.getAllByTestId('page-navigator-item');
      const contactItem = items.find((el) => el.textContent?.includes('/contact'));
      expect(contactItem).toBeDefined();
      expect((contactItem as HTMLElement).getAttribute('data-inherited')).toBeNull();
    });

    it('does not mark inherited docs with data-inherited when isMainBranch is omitted', () => {
      render(<PageNavigator {...defaultProps} />);

      const items = screen.getAllByTestId('page-navigator-item');
      const contactItem = items.find((el) => el.textContent?.includes('/contact'));
      expect(contactItem).toBeDefined();
      expect((contactItem as HTMLElement).getAttribute('data-inherited')).toBeNull();
    });
  });

  describe('"New page" create flow', () => {
    it('clicking "+ New page" calls onCreatePage (modal entry) instead of the inline form', () => {
      const onCreatePage = vi.fn();
      render(
        <PageNavigator
          {...defaultProps}
          onCreatePage={onCreatePage}
          onCreateDocument={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('page-navigator-new'));

      expect(onCreatePage).toHaveBeenCalledTimes(1);
      // The old inline create form is not used when onCreatePage is provided.
      expect(screen.queryByTestId('page-navigator-create-input')).toBeNull();
    });

    it('clicking "+ New page" shows the create form when onCreateDocument is provided', () => {
      render(<PageNavigator {...defaultProps} onCreateDocument={vi.fn()} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));

      expect(screen.getByTestId('page-navigator-create-input')).toBeDefined();
    });

    it('clicking "+ New page" shows no create form when onCreateDocument is not provided', () => {
      render(<PageNavigator {...defaultProps} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));

      expect(screen.queryByTestId('page-navigator-create-input')).toBeNull();
    });

    it('submitting the create form calls onCreateDocument with the path', async () => {
      const onCreateDocument = vi.fn().mockResolvedValue(undefined);
      render(<PageNavigator {...defaultProps} onCreateDocument={onCreateDocument} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));
      fireEvent.change(screen.getByTestId('page-navigator-create-input'), {
        target: { value: 'my-new-page' },
      });
      fireEvent.submit(screen.getByTestId('page-navigator-create-form'));

      expect(onCreateDocument).toHaveBeenCalledWith('my-new-page', null);
    });

    it('strips a leading slash from the path before calling onCreateDocument', async () => {
      const onCreateDocument = vi.fn().mockResolvedValue(undefined);
      render(<PageNavigator {...defaultProps} onCreateDocument={onCreateDocument} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));
      fireEvent.change(screen.getByTestId('page-navigator-create-input'), {
        target: { value: '/my-new-page' },
      });
      fireEvent.submit(screen.getByTestId('page-navigator-create-form'));

      expect(onCreateDocument).toHaveBeenCalledWith('my-new-page', null);
    });

    it('allows creating a homepage with "/" path', async () => {
      const onCreateDocument = vi.fn().mockResolvedValue(undefined);
      render(<PageNavigator {...defaultProps} onCreateDocument={onCreateDocument} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));
      fireEvent.change(screen.getByTestId('page-navigator-create-input'), {
        target: { value: '/' },
      });
      fireEvent.submit(screen.getByTestId('page-navigator-create-form'));

      expect(onCreateDocument).toHaveBeenCalledWith('/', null);
    });

    it('hides the create form after successful creation', async () => {
      const onCreateDocument = vi.fn().mockResolvedValue(undefined);
      render(<PageNavigator {...defaultProps} onCreateDocument={onCreateDocument} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));
      fireEvent.change(screen.getByTestId('page-navigator-create-input'), {
        target: { value: 'new-page' },
      });
      fireEvent.submit(screen.getByTestId('page-navigator-create-form'));

      await vi.waitFor(() => {
        expect(screen.queryByTestId('page-navigator-create-input')).toBeNull();
      });
    });

    it('shows an error message when onCreateDocument rejects', async () => {
      const onCreateDocument = vi.fn().mockRejectedValue(new Error('Path already exists'));
      render(<PageNavigator {...defaultProps} onCreateDocument={onCreateDocument} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));
      fireEvent.change(screen.getByTestId('page-navigator-create-input'), {
        target: { value: 'bad-path' },
      });
      fireEvent.submit(screen.getByTestId('page-navigator-create-form'));

      await vi.waitFor(() => {
        expect(screen.getByTestId('page-navigator-create-error')).toBeDefined();
        expect(screen.getByTestId('page-navigator-create-error').textContent).toBe(
          'Path already exists'
        );
      });
    });

    it('cancel button hides the create form', () => {
      render(<PageNavigator {...defaultProps} onCreateDocument={vi.fn()} />);

      fireEvent.click(screen.getByTestId('page-navigator-new'));
      expect(screen.getByTestId('page-navigator-create-input')).toBeDefined();

      fireEvent.click(screen.getByTestId('page-navigator-create-cancel'));
      expect(screen.queryByTestId('page-navigator-create-input')).toBeNull();
    });
  });
});
