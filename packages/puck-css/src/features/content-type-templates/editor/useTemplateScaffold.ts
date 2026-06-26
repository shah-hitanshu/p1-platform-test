/**
 * Template Scaffolding
 *
 * Functions for creating document data from templates.
 */

import type { Data } from '@puckeditor/core';
import type { Template } from '../types.js';

/**
 * Generate a unique component ID.
 */
function generateComponentId(): string {
  return `comp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create Puck data from a template.
 *
 * Deep-clones the template component skeleton with unique IDs.
 */
export function scaffoldFromTemplate(template: Template & { content?: Array<{ type: string; props: Record<string, unknown> }> }): Data {
  // Prefer the Puck content array (from the template's snapshot) which has
  // full component data. Fall back to the components metadata array.
  const sourceContent = (template as { content?: Array<{ type: string; props: Record<string, unknown> }> }).content ?? [];
  const sourceComponents = template.components ?? [];

  const content = sourceContent.length > 0
    ? sourceContent.map((item) => ({
        type: item.type,
        props: { ...item.props, id: generateComponentId() },
      }))
    : sourceComponents.map((component) => ({
        type: component.type,
        props: { ...component.defaultProps, id: generateComponentId() },
      }));

  return {
    root: { props: {} as Record<string, unknown> },
    content,
    zones: {},
  } as Data;
}
