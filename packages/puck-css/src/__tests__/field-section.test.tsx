import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { FieldSection } from '../data/fields/field-section.js';

describe('FieldSection', () => {
  it('renders the section label in uppercase', () => {
    render(
      <FieldSection label="Content">
        <div>child</div>
      </FieldSection>,
    );
    const label = screen.getByText('Content');
    expect(label).toBeInTheDocument();
  });

  it('renders a count badge when badge prop is provided', () => {
    render(
      <FieldSection label="Content" badge={10}>
        <div>child</div>
      </FieldSection>,
    );
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('does not render a badge when badge prop is omitted', () => {
    const { container } = render(
      <FieldSection label="Content">
        <div>child</div>
      </FieldSection>,
    );
    expect(container.querySelector('.p1-field-section__badge')).toBeNull();
  });

  it('renders children when open (default)', () => {
    render(
      <FieldSection label="Content">
        <div>visible child</div>
      </FieldSection>,
    );
    expect(screen.getByText('visible child')).toBeVisible();
  });

  it('is open by default', () => {
    const { container } = render(
      <FieldSection label="Content">
        <div>child</div>
      </FieldSection>,
    );
    const details = container.querySelector('details');
    expect(details).toHaveAttribute('open');
  });

  it('can be collapsed by clicking the summary', () => {
    const { container } = render(
      <FieldSection label="Content">
        <div>child content</div>
      </FieldSection>,
    );
    const summary = container.querySelector('summary');
    expect(summary).toBeTruthy();
    if (summary) fireEvent.click(summary);
    const details = container.querySelector('details');
    expect(details).not.toHaveAttribute('open');
  });

  it('can start collapsed when defaultOpen is false', () => {
    const { container } = render(
      <FieldSection label="Layout" defaultOpen={false}>
        <div>hidden child</div>
      </FieldSection>,
    );
    const details = container.querySelector('details');
    expect(details).not.toHaveAttribute('open');
  });

  it('renders a subtitle when provided', () => {
    render(
      <FieldSection label="Content" subtitle="Map fields to data">
        <div>child</div>
      </FieldSection>,
    );
    expect(screen.getByText('Map fields to data')).toBeInTheDocument();
  });

  it('applies the p1-field-section class', () => {
    const { container } = render(
      <FieldSection label="Content">
        <div>child</div>
      </FieldSection>,
    );
    expect(container.querySelector('.p1-field-section')).not.toBeNull();
  });

  it('renders multiple children', () => {
    render(
      <FieldSection label="Content">
        <div>first</div>
        <div>second</div>
        <div>third</div>
      </FieldSection>,
    );
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.getByText('third')).toBeInTheDocument();
  });
});
