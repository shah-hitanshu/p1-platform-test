/**
 * WizardQuestion — the reusable guided-flow question primitive (heading +
 * option pills, single- or multi-select, optional free-text "Other"). Models the
 * Claude clarifying-questions pattern used by the "Plug external data" flow.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardQuestion } from './WizardQuestion.js';

const opts = [
  { value: 'configured', label: 'Use a configured source' },
  { value: 'new', label: 'Add a new one' },
];

describe('WizardQuestion', () => {
  it('renders the question, hint and options', () => {
    render(
      <WizardQuestion
        question="Where's your data coming from?"
        hint="Pick one"
        options={opts}
        value=""
        onChange={vi.fn()}
      />,
    );
    const q = screen.getByTestId('wizard-question');
    expect(q.textContent).toContain("Where's your data coming from?");
    expect(q.textContent).toContain('Pick one');
    expect(screen.getByTestId('wizard-option-configured')).toBeDefined();
    expect(screen.getByTestId('wizard-option-new')).toBeDefined();
  });

  it('single-select: clicking an option reports its value', () => {
    const onChange = vi.fn();
    render(<WizardQuestion question="Q" options={opts} value="" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('wizard-option-new'));
    expect(onChange).toHaveBeenCalledWith('new');
  });

  it('single-select: marks the selected option aria-pressed', () => {
    render(
      <WizardQuestion question="Q" options={opts} value="configured" onChange={vi.fn()} />,
    );
    expect(
      screen.getByTestId('wizard-option-configured').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByTestId('wizard-option-new').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('multi-select: toggling accumulates then removes values', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WizardQuestion question="Q" multiple options={opts} value={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    expect(onChange).toHaveBeenCalledWith(['configured']);

    rerender(
      <WizardQuestion
        question="Q"
        multiple
        options={opts}
        value={['configured']}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('wizard-option-configured'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('supports a free-text "Other" entry', () => {
    const onChange = vi.fn();
    render(
      <WizardQuestion question="Q" options={opts} value="" onChange={onChange} allowOther />,
    );
    fireEvent.change(screen.getByTestId('wizard-other-input'), {
      target: { value: 'custom' },
    });
    expect(onChange).toHaveBeenCalledWith('custom');
  });
});
