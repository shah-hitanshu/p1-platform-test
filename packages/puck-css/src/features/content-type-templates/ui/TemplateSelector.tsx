/**
 * TemplateSelector Component
 *
 * UI for selecting a template when creating a new document.
 */

import React from 'react';
import type { P1Client } from '@pantheon-systems/css-client';
import type { TemplateSummary } from '../types.js';
import { useTemplateList } from '../hooks/useTemplateList.js';

export interface TemplateSelectorProps {
  /** P1Client instance */
  client: P1Client;
  /** Site ID */
  siteId: string;
  /** Branch ID */
  branchId: string;
  /** Callback when template is selected (null for blank page) */
  onSelect: (template: TemplateSummary | null) => void;
  /** Currently selected template ID */
  selectedTemplateId?: string | null;
}

/**
 * Template selector component for document creation.
 *
 * Displays a list of available templates plus a "Blank Page" option.
 * Uses PDS button and card styles.
 *
 * @example
 * ```tsx
 * const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
 *
 * <TemplateSelector
 *   client={client}
 *   siteId={siteId}
 *   branchId={branchId}
 *   onSelect={setSelectedTemplate}
 *   selectedTemplateId={selectedTemplate?.id}
 * />
 * ```
 */
export function TemplateSelector({
  client,
  siteId,
  branchId,
  onSelect,
  selectedTemplateId,
}: TemplateSelectorProps): React.ReactElement {
  const { templates, loading, error } = useTemplateList(client, siteId, branchId);

  if (loading) {
    return (
      <div className="template-selector template-selector--loading">
        <div className="template-selector__loading-message">
          Loading templates...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="template-selector template-selector--error">
        <div className="template-selector__error-message">
          <strong>Error loading templates</strong>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="template-selector">
      <div className="template-selector__grid">
        {/* Blank Page option always first */}
        <button
          type="button"
          className="template-selector__option pds-button pds-button--subtle"
          onClick={() => onSelect(null)}
          aria-pressed={selectedTemplateId === null || selectedTemplateId === undefined}
        >
          <div className="template-selector__option-content">
            <div className="template-selector__option-label">Blank Page</div>
            <div className="template-selector__option-description">
              Start from scratch with no template
            </div>
          </div>
        </button>

        {/* Template options (exclude deprecated) */}
        {templates.filter((t) => !t.deprecated).map((template) => (
          <button
            key={template.id}
            type="button"
            className="template-selector__option pds-button pds-button--subtle"
            onClick={() => onSelect(template)}
            aria-pressed={selectedTemplateId === template.id}
          >
            <div className="template-selector__option-content">
              <div className="template-selector__option-label">{template.label}</div>
              {template.description && (
                <div className="template-selector__option-description">
                  {template.description}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
