/**
 * TemplatePinPanel
 *
 * Displays a list of components in the template editor with pin toggles.
 * Admins use this to mark which components are "pinned" (locked in position).
 */

import React from 'react';

export interface TemplatePinPanelComponent {
  id: string;
  type: string;
}

export interface TemplatePinPanelProps {
  components: TemplatePinPanelComponent[];
  pinMap: Map<string, boolean>;
  onTogglePin: (componentId: string, pinned: boolean) => void;
}

export function TemplatePinPanel({
  components,
  pinMap,
  onTogglePin,
}: TemplatePinPanelProps): React.ReactElement {
  if (components.length === 0) {
    return (
      <div className="template-pin-panel template-pin-panel--empty">
        <p>No components added yet. Drag components into the canvas to build your template.</p>
      </div>
    );
  }

  return (
    <div className="template-pin-panel">
      <div className="template-pin-panel__header">Components</div>
      <ul className="template-pin-panel__list">
        {components.map((comp) => {
          const isPinned = pinMap.get(comp.id) ?? false;
          return (
            <li key={comp.id} className="template-pin-panel__item">
              <span className="template-pin-panel__type">{comp.type}</span>
              <label className="template-pin-panel__pin-label">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => onTogglePin(comp.id, e.target.checked)}
                />
                Pinned
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
