/**
 * WizardQuestion
 *
 * Reusable guided-flow question primitive used by the "Plug external data"
 * flow. Renders a heading (+ optional hint) and a row of selectable option
 * pills — single-select or multi-select — plus an optional free-text "Other"
 * entry. Modeled on the Claude clarifying-questions pattern.
 */

import React from 'react';

export interface WizardOption {
  value: string;
  label: string;
  description?: string;
}

export interface WizardQuestionProps {
  /** The question heading. */
  question: string;
  /** Optional sublabel (e.g. "Select all that apply"). */
  hint?: string;
  options: WizardOption[];
  /** Allow selecting multiple options (value is then a string[]). */
  multiple?: boolean;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  /** Show a free-text "Other…" entry. */
  allowOther?: boolean;
}

const headingStyle: React.CSSProperties = {
  fontSize: 'var(--pds-font-size-text-default, 15px)',
  fontWeight: 600,
  color: 'var(--pds-color-foreground-default, #1a1a1a)',
};
const hintStyle: React.CSSProperties = {
  fontSize: 'var(--pds-font-size-text-small, 13px)',
  color: 'var(--pds-color-foreground-default-secondary, #6b6b6b)',
  marginTop: 2,
};
const pillRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--pds-spacing-2xs, 8px)',
  marginTop: 'var(--pds-spacing-xs, 10px)',
};

function pillStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 999,
    border: `1px solid ${
      selected
        ? 'var(--pds-color-border-strong, #1a1a1a)'
        : 'var(--pds-color-border-default, #d4d4d4)'
    }`,
    background: selected ? 'var(--pds-color-bg-subtle, #f1f1f1)' : '#fff',
    color: 'var(--pds-color-foreground-default, #1a1a1a)',
    fontSize: 'var(--pds-font-size-text-small, 13px)',
    fontWeight: selected ? 600 : 400,
    fontFamily: 'inherit',
    cursor: 'pointer',
    lineHeight: 1.4,
  };
}

export function WizardQuestion({
  question,
  hint,
  options,
  multiple = false,
  value,
  onChange,
  allowOther = false,
}: WizardQuestionProps): React.JSX.Element {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const isSelected = (v: string): boolean => selected.includes(v);

  const handleClick = (v: string): void => {
    if (multiple) {
      onChange(isSelected(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    } else {
      onChange(v);
    }
  };

  return (
    <div data-testid="wizard-question">
      <div style={headingStyle}>{question}</div>
      {hint && <div style={hintStyle}>{hint}</div>}
      <div style={pillRowStyle}>
        {options.map((o) => {
          const on = isSelected(o.value);
          return (
            <button
              key={o.value}
              type="button"
              data-testid={`wizard-option-${o.value}`}
              aria-pressed={on}
              title={o.description}
              onClick={() => handleClick(o.value)}
              style={pillStyle(on)}
            >
              {multiple && (
                <span aria-hidden="true" style={{ fontSize: 11 }}>
                  {on ? '☑' : '☐'}
                </span>
              )}
              {o.label}
            </button>
          );
        })}
        {allowOther && (
          <input
            type="text"
            data-testid="wizard-other-input"
            placeholder="Other…"
            onChange={(e) =>
              onChange(
                multiple ? [...selected, e.target.value] : e.target.value,
              )
            }
            style={{
              ...pillStyle(false),
              cursor: 'text',
              minWidth: 120,
            }}
          />
        )}
      </div>
    </div>
  );
}
