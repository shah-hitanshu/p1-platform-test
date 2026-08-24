import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolGroup, ToolStatusLine } from '../src/components/transcript/ToolGroup.js';
import type { ToolCallStatus } from '../src/types.js';

const tool = (over: Partial<ToolCallStatus> = {}): ToolCallStatus => ({
  name: 'get_document',
  status: 'done',
  ...over,
});

describe('ToolGroup', () => {
  it('reports the in-flight step as a single line, carrying no status role of its own', () => {
    render(<ToolStatusLine tool={tool({ status: 'running' })} />);

    // The panel owns the one polite live region, so this line is visual only.
    expect(screen.getByText('Reading the page…')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a single completed call as a plain line, with no success badge', () => {
    const { container } = render(<ToolGroup tools={[tool({ input: { document_path: '/about' } })]} />);

    expect(screen.getByText('Read the page · about')).toBeTruthy();
    // Success is deliberately quiet: no pill, so failures stand out against it.
    expect(container.querySelector('.pds-badge')).toBeNull();
  });

  it('shows every step of a multi-call run, with nothing to collapse it', () => {
    render(<ToolGroup tools={[tool(), tool({ name: 'list_components' }), tool({ name: 'complete_edit_session' })]} />);

    expect(screen.getByText('Read the page')).toBeTruthy();
    expect(screen.getByText('Checked available components')).toBeTruthy();
    expect(screen.getByText('Saved changes')).toBeTruthy();
    expect(screen.queryByTestId('tool-steps-toggle')).toBeNull();
  });

  it('marks each step with its status, finished and in-flight together', () => {
    const { container } = render(
      <ToolGroup tools={[tool(), tool({ name: 'apply_document_edits', status: 'running' })]} />,
    );

    expect(screen.getByText('Read the page')).toBeTruthy();
    expect(screen.getByText('Applying changes…')).toBeTruthy();
    expect(container.querySelectorAll('.pds-icon--circleCheck')).toHaveLength(1);
    expect(container.querySelector('.pds-spinner')).toBeTruthy();
  });

  it('still marks a failure with an icon, so it stands out from the run', () => {
    const { container } = render(
      <ToolGroup tools={[tool(), tool({ name: 'apply_document_edits', result: { error: 'nope' } })]} />,
    );

    expect(container.querySelector('.pds-icon--circleExclamation')).toBeTruthy();
  });

  it('keeps every step visible once the last call returns', () => {
    const { rerender } = render(
      <ToolGroup tools={[tool(), tool({ name: 'list_components', status: 'running' })]} />,
    );
    rerender(<ToolGroup tools={[tool(), tool({ name: 'list_components' })]} />);

    expect(screen.getByText('Read the page')).toBeTruthy();
    expect(screen.getByText('Checked available components')).toBeTruthy();
  });

  it('shows a failed run expanded, with the reason visible and no disclosure to hide it', () => {
    render(<ToolGroup tools={[tool(), tool({ name: 'apply_document_edits', result: { error: 'Authentication required' } })]} />);

    // A collapsed panel is not announced to screen readers, so the failure itself is
    // never hidden — only the raw backend text sits behind a disclosure.
    expect(screen.getByText("Couldn't apply changes")).toBeTruthy();
    expect(screen.queryByText('Authentication required')).toBeNull();

    fireEvent.click(screen.getByTestId('tool-note-toggle'));
    expect(screen.getByText('Authentication required')).toBeTruthy();
  });

  it('offers no toggle when the failure carries no reason to reveal', () => {
    render(<ToolGroup tools={[tool({ name: 'apply_document_edits', result: { success: false } })]} />);

    expect(screen.getByText("Couldn't apply changes")).toBeTruthy();
    expect(screen.queryByTestId('tool-note-toggle')).toBeNull();
  });

  it('keeps the failed label out of the reason text, so the badge stays one line', () => {
    render(<ToolGroup tools={[tool({ result: { error: 'x'.repeat(120) } })]} />);

    expect(screen.getByText("Couldn't read the page")).toBeTruthy();
    fireEvent.click(screen.getByTestId('tool-note-toggle'));
    expect(screen.getByText('x'.repeat(120))).toBeTruthy();
  });

  it('renders nothing for an empty run', () => {
    const { container } = render(<ToolGroup tools={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
