/**
 * Collapsible field sections.
 *
 * Puck's object field renders its sub-fields as a flat fieldset with no way to
 * collapse it, which makes an eight-field metadata group dominate the Page tab.
 * An `overrides.fieldTypes.object` wrapper gets Puck's own object rendering as
 * `children`, so the section only has to wrap it — nothing is reimplemented and
 * the nested text/textarea overrides (the field-connect Bind buttons) still apply.
 *
 * Collapsed state is deliberately component-local: writing it anywhere near
 * `root.props` would be persisted by useAutoSave into the document.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleFieldSection } from '../editor/components/CollapsibleFieldSection.js';

describe('CollapsibleFieldSection', () => {
  it('starts collapsed when defaultCollapsed is set, hiding its children', () => {
    render(
      <CollapsibleFieldSection label="Metadata" defaultCollapsed>
        <input aria-label="Social title" />
      </CollapsibleFieldSection>,
    );

    expect(screen.queryByLabelText('Social title')).not.toBeInTheDocument();
  });

  it('starts expanded when defaultCollapsed is not set', () => {
    render(
      <CollapsibleFieldSection label="Metadata">
        <input aria-label="Social title" />
      </CollapsibleFieldSection>,
    );

    expect(screen.getByLabelText('Social title')).toBeInTheDocument();
  });

  it('reveals and re-hides its children when the toggle is activated', () => {
    render(
      <CollapsibleFieldSection label="Metadata" defaultCollapsed>
        <input aria-label="Social title" />
      </CollapsibleFieldSection>,
    );

    const toggle = screen.getByRole('button', { name: /metadata/i });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Social title')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByLabelText('Social title')).not.toBeInTheDocument();
  });

  it('exposes its expanded state to assistive tech', () => {
    render(
      <CollapsibleFieldSection label="Metadata" defaultCollapsed>
        <input aria-label="Social title" />
      </CollapsibleFieldSection>,
    );

    const toggle = screen.getByRole('button', { name: /metadata/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the label as the toggle, so the section is named', () => {
    render(
      <CollapsibleFieldSection label="Open Graph" defaultCollapsed>
        <input aria-label="Social title" />
      </CollapsibleFieldSection>,
    );

    expect(screen.getByRole('button', { name: /open graph/i })).toBeInTheDocument();
  });

  it('does not call anything on the surrounding form when toggled', () => {
    // A submit-typed button inside Puck's fields <form> would submit it.
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <CollapsibleFieldSection label="Metadata" defaultCollapsed>
          <input aria-label="Social title" />
        </CollapsibleFieldSection>
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: /metadata/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
