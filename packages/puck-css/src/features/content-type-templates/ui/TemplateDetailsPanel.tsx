/**
 * TemplateDetailsPanel
 *
 * Right-sidebar panel shown when editing a template in the regular editor
 * (template mode — document path `_registry/templates/<name>`). It replaces the
 * default "Page" root fields with a "Template" section exposing the template's
 * Label, Description and URL pattern. Edits **autosave** (debounced) to the
 * template's metadata via `onSave`; the layout itself is saved by the canvas.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { TemplateSummary } from '../types.js';

/** Delay after the last keystroke before autosaving the template details. */
const AUTOSAVE_DEBOUNCE_MS = 600;

export interface TemplateDetailsSave {
  label: string;
  description: string;
  defaultUrlPattern: string;
}

export interface TemplateDetailsPanelProps {
  /** The template being edited (provides current label/description/URL pattern). */
  template: Pick<
    TemplateSummary,
    'id' | 'label' | 'name' | 'description' | 'defaultUrlPattern'
  >;
  /** Persist the edited details (e.g. via templates.update). */
  onSave: (details: TemplateDetailsSave) => Promise<void> | void;
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--pds-spacing-2xs, 4px)',
};
const labelStyle: React.CSSProperties = {
  fontSize: 'var(--pds-font-size-text-small, 13px)',
  fontWeight: 600,
  color: 'var(--pds-color-foreground-default, #1a1a1a)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 'var(--pds-spacing-2xs, 6px) var(--pds-spacing-xs, 8px)',
  fontSize: 'var(--pds-font-size-text-small, 13px)',
  fontFamily: 'inherit',
  color: 'var(--pds-color-foreground-default, #1a1a1a)',
  border: '1px solid var(--pds-color-border-default, #ccc)',
  borderRadius: 'var(--pds-border-radius-input, 4px)',
};

export function TemplateDetailsPanel({
  template,
  onSave,
}: TemplateDetailsPanelProps): React.JSX.Element {
  const [label, setLabel] = useState(template.label ?? '');
  const [description, setDescription] = useState(template.description ?? '');
  const [defaultUrlPattern, setDefaultUrlPattern] = useState(
    template.defaultUrlPattern ?? '',
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Skip the autosave that the initial mount / template-switch re-sync would
  // otherwise trigger (those aren't user edits).
  const skipNextAutosaveRef = useRef(true);

  // Re-sync the fields when a different template is loaded into the editor.
  useEffect(() => {
    setLabel(template.label ?? '');
    setDescription(template.description ?? '');
    setDefaultUrlPattern(template.defaultUrlPattern ?? '');
    setError(null);
    setStatus('idle');
    skipNextAutosaveRef.current = true;
    // Keyed on the template id: switching documents swaps the whole record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  const save = useCallback(async () => {
    setStatus('saving');
    setError(null);
    try {
      await onSave({
        label: label.trim(),
        description: description.trim(),
        defaultUrlPattern: defaultUrlPattern.trim(),
      });
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template details');
      setStatus('error');
    }
  }, [label, description, defaultUrlPattern, onSave]);

  // Call the latest `save` via a ref so the autosave effect only depends on the
  // field VALUES. `save`/`onSave` get new identities on every render (onSave is
  // an inline closure upstream); depending on them would re-run the effect each
  // render and create a save → refetch → re-render → save loop.
  const saveRef = useRef(save);
  saveRef.current = save;

  // Debounced autosave on edits. A label is required; we never autosave a blank
  // label (it's the template's human-readable name).
  useEffect(() => {
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    if (!label.trim()) return;
    const timer = setTimeout(() => {
      void saveRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [label, description, defaultUrlPattern]);

  return (
    <div
      data-testid="template-details-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--puck-space-px, 16px)',
        // Match the regular block-edit fields gutter (Puck wraps default fields
        // in `padding: var(--puck-space-px)`; overriding `fields` drops it).
        padding: 'var(--puck-space-px, 16px)',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--pds-font-size-text-small, 13px)',
          color: 'var(--pds-color-foreground-default-secondary, #6b6b6b)',
        }}
      >
        Template details — applied to pages created from this template.
      </p>

      <div style={fieldStyle}>
        <label htmlFor="template-details-name" style={labelStyle}>
          Name
        </label>
        <input
          id="template-details-name"
          data-testid="template-details-name"
          type="text"
          disabled
          readOnly
          value={template.name ?? ''}
          style={{
            ...inputStyle,
            color: 'var(--pds-color-foreground-default-secondary, #6b6b6b)',
            background: 'var(--pds-color-background-subtle, #f4f4f4)',
            cursor: 'not-allowed',
          }}
        />
        <span
          style={{
            fontSize: 'var(--pds-font-size-text-xsmall, 12px)',
            color: 'var(--pds-color-foreground-default-secondary, #6b6b6b)',
          }}
        >
          Identifier — can’t be changed.
        </span>
      </div>

      <div style={fieldStyle}>
        <label htmlFor="template-details-label" style={labelStyle}>
          Label
        </label>
        <input
          id="template-details-label"
          data-testid="template-details-label"
          type="text"
          style={inputStyle}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="template-details-description" style={labelStyle}>
          Description
        </label>
        <textarea
          id="template-details-description"
          data-testid="template-details-description"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="template-details-url-pattern" style={labelStyle}>
          URL pattern
        </label>
        <input
          id="template-details-url-pattern"
          data-testid="template-details-url-pattern"
          type="text"
          placeholder="/blog/:slug"
          style={inputStyle}
          value={defaultUrlPattern}
          onChange={(e) => setDefaultUrlPattern(e.target.value)}
        />
      </div>

      {error && (
        <div
          data-testid="template-details-error"
          role="alert"
          style={{
            color: 'var(--pds-color-status-critical-foreground, #c00)',
            fontSize: 'var(--pds-font-size-text-small, 13px)',
          }}
        >
          {error}
        </div>
      )}

      <div
        data-testid="template-details-status"
        aria-live="polite"
        style={{
          minHeight: '1.25em',
          fontSize: 'var(--pds-font-size-text-xsmall, 12px)',
          color: 'var(--pds-color-foreground-default-secondary, #6b6b6b)',
        }}
      >
        {!label.trim()
          ? 'Add a label to save'
          : status === 'saving'
            ? 'Saving…'
            : status === 'saved'
              ? 'Saved'
              : ''}
      </div>
    </div>
  );
}
