/**
 * Convert Puck data + pin map to template creation/update params.
 */

import type { UpdateTemplateParams, TemplateComponent } from '../types.js';

interface PuckComponent {
  type: string;
  props: Record<string, unknown>;
}

interface PuckDataShape {
  content: PuckComponent[];
  root: { props: Record<string, unknown> };
  zones?: Record<string, PuckComponent[]>;
}

export interface TemplateMetadataInput {
  name: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string;
}

export function dataToUpdateParams(
  data: PuckDataShape,
  pinMap: Map<string, boolean>,
  metadata: Partial<TemplateMetadataInput>,
): UpdateTemplateParams {
  const components: TemplateComponent[] = data.content.map((comp) => {
    const { id: _id, ...defaultProps } = comp.props;
    return {
      type: comp.type,
      pinned: pinMap.get(comp.props.id as string) ?? false,
      defaultProps,
    };
  });

  return {
    label: metadata.label,
    description: metadata.description,
    defaultUrlPattern: metadata.defaultUrlPattern,
    components,
  };
}
