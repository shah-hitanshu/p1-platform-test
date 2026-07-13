/**
 * TemplateDetailsPanel Component Tests
 *
 * The right-sidebar panel shown when editing a template in the regular editor
 * (template mode). It replaces the "Page" root fields with a "Template" section
 * exposing the template's Label, Description and URL pattern, saved via onSave.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TemplateDetailsPanel } from '../../../features/content-type-templates/ui/TemplateDetailsPanel.js';
import type { TemplateSummary } from '../../../features/content-type-templates/types.js';

const template: TemplateSummary = {
  id: 'tpl-1',
  name: 'blog-post',
  label: 'Blog Post',
  description: 'Standard blog layout',
  defaultUrlPattern: '/blog/:slug',
  version: 2,
  updatedAt: '2026-06-27T00:00:00.000Z',
};

describe('TemplateDetailsPanel', () => {
  it('renders a "Template" heading (not "Page")', () => {
    render(<TemplateDetailsPanel template={template} onSave={vi.fn()} />);

    const panel = screen.getByTestId('template-details-panel');
    expect(panel.textContent).toContain('Template');
    expect(panel.textContent).not.toContain('Page');
  });

  it('shows the template name read-only alongside the editable label', () => {
    render(<TemplateDetailsPanel template={template} onSave={vi.fn()} />);

    const name = screen.getByTestId('template-details-name') as HTMLInputElement;
    expect(name.value).toBe('blog-post');
    // Name is the template identifier (the _registry path) — not editable.
    expect(name.disabled).toBe(true);
    // Label stays editable.
    expect(
      (screen.getByTestId('template-details-label') as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it('prefills Label, Description and URL pattern from the template', () => {
    render(<TemplateDetailsPanel template={template} onSave={vi.fn()} />);

    expect((screen.getByTestId('template-details-label') as HTMLInputElement).value).toBe(
      'Blog Post',
    );
    expect(
      (screen.getByTestId('template-details-description') as HTMLTextAreaElement).value,
    ).toBe('Standard blog layout');
    expect(
      (screen.getByTestId('template-details-url-pattern') as HTMLInputElement).value,
    ).toBe('/blog/:slug');
  });

  it('autosaves the edited details via onSave (debounced)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TemplateDetailsPanel template={template} onSave={onSave} />);

    fireEvent.change(screen.getByTestId('template-details-label'), {
      target: { value: 'News Article' },
    });
    fireEvent.change(screen.getByTestId('template-details-description'), {
      target: { value: 'Newsroom layout' },
    });
    fireEvent.change(screen.getByTestId('template-details-url-pattern'), {
      target: { value: '/news/:slug' },
    });

    // No explicit save action — the autosave fires after the debounce.
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        label: 'News Article',
        description: 'Newsroom layout',
        defaultUrlPattern: '/news/:slug',
      }),
    );
  });

  it('does not re-autosave on re-render when fields are unchanged (no save loop)', async () => {
    // Each render passes a NEW onSave identity (upstream it is an inline
    // closure, and a save triggers a refetch → re-render). The autosave must
    // key off field VALUES only, or it loops: save → refetch → re-render → save.
    let calls = 0;
    const makeOnSave = () => vi.fn(() => {
      calls += 1;
      return Promise.resolve();
    });

    const { rerender } = render(
      <TemplateDetailsPanel template={template} onSave={makeOnSave()} />,
    );

    fireEvent.change(screen.getByTestId('template-details-label'), {
      target: { value: 'Edited Label' },
    });
    await waitFor(() => expect(calls).toBe(1));

    // Re-render with a fresh onSave (no field change) — must NOT autosave again.
    rerender(<TemplateDetailsPanel template={template} onSave={makeOnSave()} />);
    await new Promise((r) => setTimeout(r, 800));
    expect(calls).toBe(1);
  });

  it('does not autosave while the label is empty', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TemplateDetailsPanel template={template} onSave={onSave} />);

    fireEvent.change(screen.getByTestId('template-details-label'), {
      target: { value: '' },
    });

    // Wait past the debounce window; a blank label must never autosave.
    await new Promise((r) => setTimeout(r, 800));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('template-details-status').textContent).toContain(
      'Add a label to save',
    );
  });

  it('re-syncs the fields when a different template is supplied', () => {
    const { rerender } = render(
      <TemplateDetailsPanel template={template} onSave={vi.fn()} />,
    );
    expect((screen.getByTestId('template-details-label') as HTMLInputElement).value).toBe(
      'Blog Post',
    );

    rerender(
      <TemplateDetailsPanel
        template={{ ...template, id: 'tpl-2', label: 'Event' }}
        onSave={vi.fn()}
      />,
    );
    expect((screen.getByTestId('template-details-label') as HTMLInputElement).value).toBe(
      'Event',
    );
  });
});
