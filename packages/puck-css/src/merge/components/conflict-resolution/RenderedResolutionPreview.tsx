/**
 * RenderedResolutionPreview Component
 *
 * Renders a preview of the merged PuckData state. Shows a summary
 * of the merged document's content components and root props.
 */

import React from 'react';
import type { PuckData } from '@pantheon-systems/css-client';

/**
 * Props for the RenderedResolutionPreview component.
 */
export interface RenderedResolutionPreviewProps {
  /** The merged PuckData to preview */
  mergedData: PuckData;
  /** Optional Puck config for richer rendering (unused for now) */
  config?: unknown;
}

const baseClass = 'rendered-resolution-preview';

/**
 * Formats a value for display in the preview.
 */
function formatPreviewValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Preview component that shows a summary of the merged PuckData.
 *
 * Currently renders a key-value summary of all components and their
 * props. Can be extended later to render a full Puck preview when
 * a Puck config is available.
 *
 * @param props - {@link RenderedResolutionPreviewProps}
 * @returns A React element displaying root props, content components, and zones.
 *
 * @example
 * ```tsx
 * <RenderedResolutionPreview
 *   mergedData={mergedSnapshot}
 *   config={puckConfig}
 * />
 * ```
 */
export function RenderedResolutionPreview({
  mergedData,
  config: _config,
}: RenderedResolutionPreviewProps): React.ReactElement {
  return (
    <div className={baseClass}>
      <h3 className={`${baseClass}__title`}>Merged Preview</h3>

      {/* Root props */}
      {mergedData.root?.props &&
        Object.keys(mergedData.root.props).length > 0 && (
          <div className={`${baseClass}__root`}>
            <h4 className={`${baseClass}__section-title`}>Page Settings</h4>
            <dl className={`${baseClass}__prop-list`}>
              {Object.entries(mergedData.root.props).map(([key, value]) => (
                <div key={key} className={`${baseClass}__prop`}>
                  <dt className={`${baseClass}__prop-name`}>{key}</dt>
                  <dd className={`${baseClass}__prop-value`}>
                    {formatPreviewValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

      {/* Content components */}
      {mergedData.content.length > 0 && (
        <div className={`${baseClass}__content`}>
          <h4 className={`${baseClass}__section-title`}>Components</h4>
          {mergedData.content.map((component) => (
            <div
              key={component.props.id}
              className={`${baseClass}__component`}
            >
              <h5 className={`${baseClass}__component-type`}>
                {component.type}
              </h5>
              <dl className={`${baseClass}__prop-list`}>
                {Object.entries(component.props)
                  .filter(([key]) => key !== 'id')
                  .map(([key, value]) => (
                    <div key={key} className={`${baseClass}__prop`}>
                      <dt className={`${baseClass}__prop-name`}>{key}</dt>
                      <dd className={`${baseClass}__prop-value`}>
                        {formatPreviewValue(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* Zones */}
      {mergedData.zones &&
        Object.entries(mergedData.zones).map(([zoneName, components]) => (
          <div key={zoneName} className={`${baseClass}__zone`}>
            <h4 className={`${baseClass}__section-title`}>
              Zone: {zoneName}
            </h4>
            {components.map((component) => (
              <div
                key={component.props.id}
                className={`${baseClass}__component`}
              >
                <h5 className={`${baseClass}__component-type`}>
                  {component.type}
                </h5>
                <dl className={`${baseClass}__prop-list`}>
                  {Object.entries(component.props)
                    .filter(([key]) => key !== 'id')
                    .map(([key, value]) => (
                      <div key={key} className={`${baseClass}__prop`}>
                        <dt className={`${baseClass}__prop-name`}>{key}</dt>
                        <dd className={`${baseClass}__prop-value`}>
                          {formatPreviewValue(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
