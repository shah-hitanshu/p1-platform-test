/**
 * CreatePageModal Tests
 *
 * The "Create a new page" modal that replaces the inline "+ New page" form.
 * Single-screen design: pick a starting point (only "Blank page" active in
 * Phase 1), enter a title (which auto-derives the URL slug), optionally expand
 * a (disabled) Advanced panel, then "Create page".
 *
 * Phase 1 scope:
 *   - Starting points: Blank page (active); Content type template, Generate
 *     with AI (disabled); New page template (admin-only, disabled).
 *   - Title auto-derives slug until the slug is edited manually.
 *   - Slug is sanitized: lowercase, no spaces, no special characters.
 *   - Advanced panel is rendered as designed but fully disabled.
 *   - Create calls onCreateDocument(slug).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { CreatePageModal } from './CreatePageModal.js';

afterEach(() => {
  cleanup();
});

describe('CreatePageModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreateDocument: vi.fn().mockResolvedValue(undefined),
  };

  // Real content-type templates as they arrive from the backend. The modal has
  // no built-in/fake list: a customer running P1 with zero templates is a normal
  // state (it shows an empty message). Tests that exercise content-type behavior
  // pass this fixture explicitly.
  const templatesFixture = [
    {
      id: 'blog-post',
      name: 'blog-post',
      label: 'Blog post',
      description: 'Your best-in-class blog post layout.',
      defaultUrlPattern: '/blog/:year/:month/:slug',
      version: 1,
    },
    {
      id: 'article',
      name: 'article',
      label: 'Article',
      description: 'A standard template for editorial content.',
      defaultUrlPattern: '/articles/:section',
      version: 1,
    },
  ];

  // ---------------------------------------------------------------------------
  // Open / close / chrome
  // ---------------------------------------------------------------------------

  it('renders nothing when open is false', () => {
    render(<CreatePageModal {...defaultProps} open={false} />);

    expect(screen.queryByTestId('create-page-modal')).toBeNull();
  });

  it('renders the "Create a new page" title and subtitle when open', () => {
    render(<CreatePageModal {...defaultProps} />);

    expect(screen.getByTestId('create-page-modal')).toBeDefined();
    expect(screen.getByTestId('create-page-modal-title').textContent).toBe(
      'Create a new page',
    );
    expect(
      screen.getByText('Pick a starting point, name it, and you’re editing.'),
    ).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Starting-point options
  // ---------------------------------------------------------------------------

  it('renders the Blank page, Content type template and Generate with AI options', () => {
    render(<CreatePageModal {...defaultProps} />);

    expect(screen.getByTestId('create-page-option-blank')).toBeDefined();
    expect(screen.getByTestId('create-page-option-content-type-template')).toBeDefined();
    expect(screen.getByTestId('create-page-option-generate-ai')).toBeDefined();
  });

  it('renders a fourth "Plug external data" starting point with an icon', () => {
    render(<CreatePageModal {...defaultProps} />);

    const tile = screen.getByTestId('create-page-option-plug-external-data');
    expect(tile.textContent).toContain('Plug external data');
    expect(tile.textContent).toContain('build pages from them');
    expect(tile.querySelector('svg')).not.toBeNull();
  });

  it('enables all starting-point options', () => {
    render(<CreatePageModal {...defaultProps} />);

    ['blank', 'content-type-template', 'generate-ai'].forEach((key) => {
      expect(
        (screen.getByTestId(`create-page-option-${key}`) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  it('lists the real templates from the templates prop when Content type template is selected', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    expect(screen.queryByTestId('create-page-content-types')).toBeNull();

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));

    expect(screen.getByTestId('create-page-content-types')).toBeDefined();
    // Real templates appear, keyed by id, with their label.
    expect(screen.getByTestId('create-page-content-type-blog-post')).toBeDefined();
    expect(screen.getByTestId('create-page-content-type-blog-post').textContent).toContain(
      'Blog post',
    );
    expect(screen.getByTestId('create-page-content-type-article')).toBeDefined();
  });

  it('falls back to the template name when a content type has no label', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        templates={[{ id: 'stage', name: 'stage', label: '', version: 1 }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));

    // A label-less template still shows (by name), not as a blank tile.
    expect(screen.getByTestId('create-page-content-type-stage').textContent).toContain(
      'stage',
    );
  });

  it('shows "No Page type template configured" when there are no templates', () => {
    render(<CreatePageModal {...defaultProps} templates={[]} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));

    const empty = screen.getByTestId('create-page-content-types-empty');
    expect(empty).toBeDefined();
    expect(empty.textContent).toContain('No Page type template configured');
    // No template tiles are rendered in the empty state.
    expect(screen.queryByTestId('create-page-content-type-article')).toBeNull();
    expect(screen.queryByTestId('create-page-content-type-blog-post')).toBeNull();
  });

  it('hides Page title and URL until a content type is picked', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    expect(screen.queryByTestId('create-page-title-input')).toBeNull();
    expect(screen.queryByTestId('create-page-slug-input')).toBeNull();

    fireEvent.click(screen.getByTestId('create-page-content-type-blog-post'));
    expect(screen.getByTestId('create-page-title-input')).toBeDefined();
  });

  it('keeps Create page disabled while Content type template is selected (mocked)', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));

    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the template definition form when "New template" is selected', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));

    expect(screen.getByTestId('create-template-name')).toBeDefined();
    expect(screen.getByTestId('create-template-label')).toBeDefined();
    expect(screen.getByTestId('create-template-description')).toBeDefined();
    expect(screen.getByTestId('create-template-pattern')).toBeDefined();
    // The page-title / URL section is replaced in this flow.
    expect(screen.queryByTestId('create-page-title-input')).toBeNull();
  });

  it('switches to the "Create a page template" screen for New template', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));

    expect(screen.getByTestId('create-page-modal-title').textContent).toBe(
      'Create a page template',
    );
    // The page-creation tiles are hidden on the template screen.
    expect(screen.queryByTestId('create-page-option-blank')).toBeNull();
    // And there's a way back.
    expect(screen.getByTestId('create-template-back')).toBeDefined();
  });

  it('returns to page creation from the template screen via Back', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));
    fireEvent.click(screen.getByTestId('create-template-back'));

    expect(screen.getByTestId('create-page-modal-title').textContent).toBe(
      'Create a new page',
    );
    expect(screen.getByTestId('create-page-option-blank')).toBeDefined();
  });

  it('derives the template Label from the Name until Label is edited', () => {
    render(<CreatePageModal {...defaultProps} />);
    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));

    fireEvent.change(screen.getByTestId('create-template-name'), {
      target: { value: 'Blog' },
    });
    expect((screen.getByTestId('create-template-label') as HTMLInputElement).value).toBe(
      'Blog',
    );

    fireEvent.change(screen.getByTestId('create-template-label'), {
      target: { value: 'Blog Post' },
    });
    fireEvent.change(screen.getByTestId('create-template-name'), {
      target: { value: 'News' },
    });
    // Label keeps the manual value once edited.
    expect((screen.getByTestId('create-template-label') as HTMLInputElement).value).toBe(
      'Blog Post',
    );
  });

  it('validates the template URL pattern', () => {
    render(<CreatePageModal {...defaultProps} />);
    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));

    // No param → invalid.
    fireEvent.change(screen.getByTestId('create-template-pattern'), {
      target: { value: '/blog' },
    });
    expect(screen.getByTestId('create-template-pattern-error')).toBeDefined();

    // Valid pattern → no error.
    fireEvent.change(screen.getByTestId('create-template-pattern'), {
      target: { value: '/blog/:year/:month/:slug' },
    });
    expect(screen.queryByTestId('create-template-pattern-error')).toBeNull();

    // Duplicate param name → invalid.
    fireEvent.change(screen.getByTestId('create-template-pattern'), {
      target: { value: '/recipe/:param1/test/:param1' },
    });
    expect(screen.getByTestId('create-template-pattern-error')).toBeDefined();

    // Uppercase / spaces / special chars → specific message.
    fireEvent.change(screen.getByTestId('create-template-pattern'), {
      target: { value: '/Blog/:My Slug' },
    });
    expect(screen.getByTestId('create-template-pattern-error').textContent).toContain(
      'Special characters, upper case and spaces are not welcome.',
    );
  });

  it('disables "Create template" until Name, Label and a valid pattern are set', () => {
    render(<CreatePageModal {...defaultProps} onCreateTemplate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));

    const submit = () => screen.getByTestId('create-page-submit') as HTMLButtonElement;
    expect(submit().disabled).toBe(true); // empty

    // Name fills Label too (Label mirrors Name); empty URL pattern is allowed.
    fireEvent.change(screen.getByTestId('create-template-name'), {
      target: { value: 'Recipes' },
    });
    expect(submit().disabled).toBe(false);

    // A non-empty but invalid pattern disables again.
    fireEvent.change(screen.getByTestId('create-template-pattern'), {
      target: { value: '/blog' },
    });
    expect(submit().disabled).toBe(true);
  });

  it('creates a template from the New template screen and opens its editor', async () => {
    const onCreateTemplate = vi.fn().mockResolvedValue({
      id: 't9',
      name: 'recipes',
      label: 'Recipes',
      version: 1,
      components: [],
      updatedAt: '',
    });
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreatePageModal
        {...defaultProps}
        onClose={onClose}
        onNavigate={onNavigate}
        onCreateTemplate={onCreateTemplate}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-new-template'));

    fireEvent.change(screen.getByTestId('create-template-name'), {
      target: { value: 'Recipes' },
    });
    fireEvent.change(screen.getByTestId('create-template-description'), {
      target: { value: 'Recipe pages' },
    });
    fireEvent.change(screen.getByTestId('create-template-pattern'), {
      target: { value: '/recipes/:slug' },
    });

    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() =>
      expect(onCreateTemplate).toHaveBeenCalledWith({
        name: 'recipes',
        label: 'Recipes',
        description: 'Recipe pages',
        defaultUrlPattern: '/recipes/:slug',
      }),
    );
    // Opens the new template in the editor (template mode) and closes.
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith('_registry/templates/recipes'),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders a route input for each param of the selected template’s URL pattern', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-blog-post'));

    // /blog/:year/:month/:slug
    expect(screen.getByTestId('create-page-param-year')).toBeDefined();
    expect(screen.getByTestId('create-page-param-month')).toBeDefined();
    expect(screen.getByTestId('create-page-param-slug')).toBeDefined();
  });

  it('auto-fills the slug param from the page title in a template route', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-blog-post'));
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My Post' },
    });

    expect((screen.getByTestId('create-page-param-slug') as HTMLInputElement).value).toBe(
      'my-post',
    );
  });

  it('uses the template’s URL pattern params (Article has :section, no :slug)', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-article'));

    expect(screen.getByTestId('create-page-param-section')).toBeDefined();
    expect(screen.queryByTestId('create-page-param-slug')).toBeNull();
    expect(screen.queryByTestId('create-page-param-year')).toBeNull();
  });

  it('keeps Create disabled until the content type’s params are filled', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-article'));

    const submit = () => screen.getByTestId('create-page-submit') as HTMLButtonElement;
    expect(submit().disabled).toBe(true); // :section empty

    fireEvent.change(screen.getByTestId('create-page-param-section'), {
      target: { value: 'news' },
    });
    expect(submit().disabled).toBe(false);
  });

  it('creates a page from a selected content-type template (passes the template id)', async () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreatePageModal
        {...defaultProps}
        templates={templatesFixture}
        onCreateDocument={onCreateDocument}
        onNavigate={onNavigate}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-blog-post'));
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My Post' },
    });
    fireEvent.change(screen.getByTestId('create-page-param-year'), {
      target: { value: '2026' },
    });
    fireEvent.change(screen.getByTestId('create-page-param-month'), {
      target: { value: '06' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    // Path built from the template's URL pattern; template id passed for scaffold+bind.
    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith(
        'blog/2026/06/my-post',
        'My Post',
        'blog-post',
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onNavigate).toHaveBeenCalledWith('blog/2026/06/my-post');
  });

  it('flags a missing title (red) and keeps Create disabled for a content type', () => {
    render(<CreatePageModal {...defaultProps} templates={templatesFixture} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-blog-post'));

    // No title yet → red hint shown, Create disabled.
    expect(screen.getByTestId('create-page-title-required')).toBeDefined();
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My Post' },
    });
    expect(screen.queryByTestId('create-page-title-required')).toBeNull();
  });

  it('flags a missing title (red) and keeps Create disabled for a blank page', () => {
    render(<CreatePageModal {...defaultProps} />);

    // Blank is selected by default; with no title the slug is empty, so
    // Create must be disabled and the title-required hint shown.
    expect(screen.getByTestId('create-page-title-required')).toBeDefined();
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My Page' },
    });

    expect(screen.queryByTestId('create-page-title-required')).toBeNull();
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('shows a "still in the works" note and keeps Create disabled for Generate with AI', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-generate-ai'));

    expect(
      screen.getByTestId('create-page-generate-ai-note').textContent,
    ).toContain('This feature is still in the works.');
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('creates from a pattern-less template using the slug (not an empty path)', async () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreatePageModal
        {...defaultProps}
        templates={[{ id: 'stage', name: 'stage', label: 'Stage', version: 1 }]}
        onCreateDocument={onCreateDocument}
        onNavigate={onNavigate}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));
    fireEvent.click(screen.getByTestId('create-page-content-type-stage'));
    // A pattern-less template requires a slug/title before Create works.
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My Stage' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('my-stage', 'My Stage', 'stage'),
    );
    // Navigates to the new page — not an empty path (which lands on /p1).
    expect(onNavigate).toHaveBeenCalledWith('my-stage');
    expect(onNavigate).not.toHaveBeenCalledWith('');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders an icon in each starting-point option', () => {
    render(<CreatePageModal {...defaultProps} />);

    ['blank', 'content-type-template', 'generate-ai'].forEach((key) => {
      const btn = screen.getByTestId(`create-page-option-${key}`);
      expect(btn.querySelector('svg')).not.toBeNull();
    });
  });

  it('selects Blank page by default', () => {
    render(<CreatePageModal {...defaultProps} />);

    expect(
      screen.getByTestId('create-page-option-blank').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('does not render New page template as a top-level tile', () => {
    render(<CreatePageModal {...defaultProps} />);

    expect(screen.queryByTestId('create-page-option-new-page-template')).toBeNull();
  });

  it('offers a "New template" action within the content types', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-content-type-template'));

    expect(screen.getByTestId('create-page-content-type-new-template')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Title → slug
  // ---------------------------------------------------------------------------

  it('auto-derives the slug from the page title as it is typed', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My New Page' },
    });

    expect((screen.getByTestId('create-page-slug-input') as HTMLInputElement).value).toBe(
      'my-new-page',
    );
  });

  it('sanitizes the derived slug (lowercase, no spaces, no special characters)', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Hello World! 123' },
    });

    expect((screen.getByTestId('create-page-slug-input') as HTMLInputElement).value).toBe(
      'hello-world-123',
    );
  });

  it('stops auto-deriving the slug once the slug is edited manually', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'First Title' },
    });
    // User overrides the slug.
    fireEvent.change(screen.getByTestId('create-page-slug-input'), {
      target: { value: 'custom-slug' },
    });
    // Changing the title again must NOT overwrite the manual slug.
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Second Title' },
    });

    expect((screen.getByTestId('create-page-slug-input') as HTMLInputElement).value).toBe(
      'custom-slug',
    );
  });

  it('sanitizes a manually entered slug', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('create-page-slug-input'), {
      target: { value: 'My Custom Slug!' },
    });

    expect((screen.getByTestId('create-page-slug-input') as HTMLInputElement).value).toBe(
      'my-custom-slug',
    );
  });

  it('uses the provided site host (with trailing slash) as the slug prefix', () => {
    render(<CreatePageModal {...defaultProps} siteHost="example.com" />);

    expect(screen.getByTestId('create-page-slug-prefix').textContent).toBe(
      'example.com /',
    );
  });

  // ---------------------------------------------------------------------------
  // Plug external data — collection builder (moved out of the old Advanced panel)
  // ---------------------------------------------------------------------------

  it('asks where the data comes from, then reveals the matching pane', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    expect(screen.queryByTestId('create-page-collection-builder')).toBeNull();

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));

    // The first question is shown; neither pane until a choice is made.
    expect(screen.getByTestId('create-page-collection-builder')).toBeDefined();
    expect(screen.getByTestId('wizard-option-configured')).toBeDefined();
    expect(screen.getByTestId('wizard-option-new')).toBeDefined();
    expect(screen.queryByTestId('create-page-source-select')).toBeNull();
    expect(screen.queryByTestId('create-page-add-source')).toBeNull();

    // "Use a configured source" → the source picker.
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    expect(screen.getByTestId('create-page-source-select')).toBeDefined();
    expect(screen.queryByTestId('create-page-add-source')).toBeNull();

    // "Add a new one" → the add-source form.
    fireEvent.click(screen.getByTestId('wizard-option-new'));
    expect(screen.getByTestId('create-page-add-source')).toBeDefined();
    expect(screen.queryByTestId('create-page-source-select')).toBeNull();
  });

  it('derives route params from a selected source’s inputs', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));

    // No source selected yet → no params.
    expect(screen.queryByTestId('create-page-route-param-id')).toBeNull();

    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });

    // The selected chip shows immediately; the :param appears once the structure
    // is an index + detail collection.
    expect(screen.getByTestId('create-page-selected-swapi')).toBeDefined();
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    expect(screen.getByTestId('create-page-route-param-id')).toBeDefined();
  });

  it('unions params across multiple selected sources (shared name = one param)', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[
          { id: 'swapi', label: 'Star Wars API', inputs: ['id'] },
          { id: 'pokemon', label: 'Pokemon', inputs: ['monster'] },
          { id: 'dupe', label: 'Dupe', inputs: ['id'] },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));

    const sourceSelect = screen.getByTestId('create-page-source-select');
    fireEvent.change(sourceSelect, { target: { value: 'swapi' } });
    fireEvent.change(sourceSelect, { target: { value: 'pokemon' } });
    fireEvent.change(sourceSelect, { target: { value: 'dupe' } });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));

    // Distinct inputs each get a param; the shared "id" is deduped to one.
    expect(screen.getByTestId('create-page-route-param-id')).toBeDefined();
    expect(screen.getByTestId('create-page-route-param-monster')).toBeDefined();
    expect(screen.getAllByTestId('create-page-route-param-id')).toHaveLength(1);
  });

  it('explains why "+ Add source" is disabled until a name is entered', () => {
    render(<CreatePageModal {...defaultProps} datasources={[]} />);

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-new'));

    // No name yet → hint shown, "+ Add source" disabled.
    expect(screen.getByTestId('create-page-new-name-required')).toBeDefined();
    expect(
      (screen.getByTestId('create-page-add-source') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId('create-page-new-name'), {
      target: { value: 'Recipes' },
    });

    expect(screen.queryByTestId('create-page-new-name-required')).toBeNull();
    expect(
      (screen.getByTestId('create-page-add-source') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('adds a data source on the fly, deriving its inputs from the URL', () => {
    render(<CreatePageModal {...defaultProps} datasources={[]} />);

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-new'));

    fireEvent.change(screen.getByTestId('create-page-new-name'), {
      target: { value: 'Recipes' },
    });
    fireEvent.change(screen.getByTestId('create-page-new-url'), {
      target: { value: 'https://api.example.com/recipes/:slug' },
    });
    fireEvent.click(screen.getByTestId('create-page-add-source'));

    // The new source is selected and contributes its :slug param (collection).
    expect(screen.getByTestId('create-page-selected-recipes')).toBeDefined();
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    expect(screen.getByTestId('create-page-route-param-slug')).toBeDefined();
  });

  it('summarizes the generated collection route and its sources', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Blog' },
    });
    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));

    const summary = screen.getByTestId('create-page-collection-summary').textContent;
    expect(summary).toContain('/blog/:id');
    expect(summary).toContain('swapi');
  });

  it('shows a note that only public data sources can be added on the fly', () => {
    render(<CreatePageModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-new'));

    const note = screen.getByTestId('create-page-add-source-note').textContent ?? '';
    expect(note).toContain('publicly available');
    expect(note).toContain('developer');
  });

  it('auto-generates a "<name>Id" param when the added source URL has none', () => {
    render(<CreatePageModal {...defaultProps} datasources={[]} />);

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-new'));

    fireEvent.change(screen.getByTestId('create-page-new-name'), {
      target: { value: 'recipes' },
    });
    // No :param in the URL.
    fireEvent.change(screen.getByTestId('create-page-new-url'), {
      target: { value: 'https://api.example.com/recipes' },
    });
    fireEvent.click(screen.getByTestId('create-page-add-source'));
    fireEvent.click(screen.getByTestId('wizard-option-collection'));

    expect(screen.getByTestId('create-page-route-param-recipesId')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  it('labels the action "+ Create pages" on the Plug external data flow', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));

    expect(screen.getByTestId('create-page-submit').textContent).toContain(
      '+ Create pages',
    );
  });

  it('shows a recap (not a single page) after creating a collection', async () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <CreatePageModal
        {...defaultProps}
        onCreateDocument={onCreateDocument}
        onClose={onClose}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Blog' },
    });
    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    fireEvent.click(screen.getByTestId('create-page-submit'));

    // Both pages created (index + dynamic at the route pattern), then a recap
    // with two edit actions — modal stays open.
    await waitFor(() => {
      expect(screen.getByTestId('create-page-recap')).toBeDefined();
    });
    expect(onCreateDocument).toHaveBeenCalledWith('blog', 'Blog');
    expect(onCreateDocument).toHaveBeenCalledWith('/blog/:id', 'Blog');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-page-recap-edit-index')).toBeDefined();
    expect(screen.getByTestId('create-page-recap-edit-dynamic')).toBeDefined();
  });

  it('navigates to the dynamic page from the recap', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreatePageModal
        {...defaultProps}
        onCreateDocument={vi.fn().mockResolvedValue(undefined)}
        onNavigate={onNavigate}
        onClose={onClose}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Blog' },
    });
    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('create-page-recap-edit-dynamic')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('create-page-recap-edit-dynamic'));

    expect(onNavigate).toHaveBeenCalledWith('/blog/:id');
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for the page title only after the structure question is answered', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    // No title field until the structure is chosen.
    expect(screen.queryByTestId('create-page-title-input')).toBeNull();

    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    expect(screen.getByTestId('create-page-title-input')).toBeDefined();
  });

  it('"Everything on one page" creates a single page (no dynamic route, no recap)', async () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreatePageModal
        {...defaultProps}
        onCreateDocument={onCreateDocument}
        onNavigate={onNavigate}
        onClose={onClose}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-single'));

    // Single page: no per-item route param, and the action is "+ Create page".
    expect(screen.queryByTestId('create-page-route-param-id')).toBeNull();
    expect(screen.getByTestId('create-page-submit').textContent).toContain(
      '+ Create page',
    );
    expect(screen.getByTestId('create-page-submit').textContent).not.toContain(
      'Create pages',
    );

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Directory' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('directory', 'Directory'),
    );
    expect(onCreateDocument).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('directory');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('create-page-recap')).toBeNull();
  });

  it('shows an inline loader while creating, then the inline recap', async () => {
    let resolveCreate!: () => void;
    const pending = new Promise<void>((res) => {
      resolveCreate = res;
    });
    const onCreateDocument = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue(undefined);
    render(
      <CreatePageModal
        {...defaultProps}
        onCreateDocument={onCreateDocument}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Blog' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    // While the first create is pending: inline loader replaces the button.
    expect(await screen.findByTestId('create-page-creating')).toBeDefined();
    expect(screen.queryByTestId('create-page-submit')).toBeNull();

    await act(async () => {
      resolveCreate();
    });

    expect(await screen.findByTestId('create-page-recap')).toBeDefined();
    expect(screen.queryByTestId('create-page-creating')).toBeNull();
  });

  it('shows the Index and Detail page routes separately for a collection', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[{ id: 'swapi', label: 'Star Wars API', inputs: ['id'] }]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    // The index-page title prepares both routes (shared slug base).
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Blog' },
    });

    const index = screen.getByTestId('create-page-route-index');
    const detail = screen.getByTestId('create-page-route-detail');
    // Index row has the editable slug input; detail mirrors it as static text.
    expect((index.querySelector('input') as HTMLInputElement).value).toBe('blog');
    expect(detail.textContent).toContain('blog');
    // The :param lives on the detail route only, not the index.
    expect(
      detail.querySelector('[data-testid="create-page-route-param-id"]'),
    ).not.toBeNull();
    expect(
      index.querySelector('[data-testid="create-page-route-param-id"]'),
    ).toBeNull();
  });

  it('blocks "index + detail" when the source yields no per-item param', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[
          { id: 'swapi_list', label: 'Star Wars API (people index)', inputs: [] },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi_list' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-collection'));
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'People' },
    });

    // A list source can't identify a single item → no detail param → blocked.
    expect(screen.getByTestId('create-page-collection-needs-param')).toBeDefined();
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('allows "everything on one page" with a list-only source', () => {
    render(
      <CreatePageModal
        {...defaultProps}
        datasources={[
          { id: 'swapi_list', label: 'Star Wars API (people index)', inputs: [] },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('create-page-option-plug-external-data'));
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    fireEvent.change(screen.getByTestId('create-page-source-select'), {
      target: { value: 'swapi_list' },
    });
    fireEvent.click(screen.getByTestId('wizard-option-single'));
    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'People' },
    });

    expect(screen.queryByTestId('create-page-collection-needs-param')).toBeNull();
    expect(
      (screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('calls onCreateDocument with the slug and the page title on Create page', () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    render(<CreatePageModal {...defaultProps} onCreateDocument={onCreateDocument} />);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'My New Page' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    expect(onCreateDocument).toHaveBeenCalledWith('my-new-page', 'My New Page');
  });

  it('disables Create and shows progress while the create is in flight', async () => {
    let resolveCreate: () => void = () => {};
    const onCreateDocument = vi.fn(
      () => new Promise<void>((res) => { resolveCreate = res; }),
    );
    render(<CreatePageModal {...defaultProps} onCreateDocument={onCreateDocument} />);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'New Page' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    const submit = screen.getByTestId('create-page-submit') as HTMLButtonElement;
    await waitFor(() => {
      expect(submit.disabled).toBe(true);
    });
    expect(submit.textContent).toContain('Creating');

    // A second submit while pending must not trigger another create.
    fireEvent.click(submit);
    expect(onCreateDocument).toHaveBeenCalledTimes(1);

    resolveCreate();
  });

  it('re-enables Create after a failed create', async () => {
    const onCreateDocument = vi.fn().mockRejectedValue(new Error('Nope'));
    render(<CreatePageModal {...defaultProps} onCreateDocument={onCreateDocument} />);

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'New Page' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('create-page-error')).toBeDefined();
    });
    expect((screen.getByTestId('create-page-submit') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('does not call onCreateDocument when the slug is empty', () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    render(<CreatePageModal {...defaultProps} onCreateDocument={onCreateDocument} />);

    fireEvent.click(screen.getByTestId('create-page-submit'));

    expect(onCreateDocument).not.toHaveBeenCalled();
  });

  it('calls onClose after a successful creation', async () => {
    const onClose = vi.fn();
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    render(
      <CreatePageModal
        {...defaultProps}
        onClose={onClose}
        onCreateDocument={onCreateDocument}
      />,
    );

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'New Page' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an error and stays open when onCreateDocument rejects', async () => {
    const onClose = vi.fn();
    const onCreateDocument = vi.fn().mockRejectedValue(new Error('Path already exists'));
    render(
      <CreatePageModal
        {...defaultProps}
        onClose={onClose}
        onCreateDocument={onCreateDocument}
      />,
    );

    fireEvent.change(screen.getByTestId('create-page-title-input'), {
      target: { value: 'Dupe' },
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('create-page-error').textContent).toBe(
        'Path already exists',
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Dismissal
  // ---------------------------------------------------------------------------

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CreatePageModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('create-page-cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<CreatePageModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('create-page-modal-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<CreatePageModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('create-page-modal'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<CreatePageModal {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens directly on the New template form when initialMode="new-template"', () => {
    render(<CreatePageModal {...defaultProps} initialMode="new-template" />);

    // Lands straight on the New-template definition form, not the starting-point grid.
    expect(screen.getByTestId('create-template-name')).toBeTruthy();
  });
});
