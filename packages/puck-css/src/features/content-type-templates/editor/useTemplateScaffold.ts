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
 * Copies each content item with a shallow spread of its props and a fresh
 * component ID (durable ids across template-to-page are PCC-3358).
 */
export function scaffoldFromTemplate(template: Pick<Template, 'content'>): Data {
  const content = (template.content ?? []).map((item) => ({
    type: item.type,
    props: { ...item.props, id: generateComponentId() },
  }));

  return {
    root: { props: {} as Record<string, unknown> },
    content,
    zones: {},
  } as Data;
}
