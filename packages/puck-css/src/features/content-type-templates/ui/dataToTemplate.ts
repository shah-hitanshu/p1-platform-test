/**
 * Convert Puck data + pin map to template creation/update params.
 */

import type { CreateTemplateParams, UpdateTemplateParams, TemplateComponent } from '../types.js';

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

export function dataToCreateParams(
  data: PuckDataShape,
  pinMap: Map<string, boolean>,
  metadata: TemplateMetadataInput,
): CreateTemplateParams {
  const components: TemplateComponent[] = data.content.map((comp) => {
    const { id: _id, ...defaultProps } = comp.props;
    return {
      type: comp.type,
      pinned: pinMap.get(comp.props.id as string) ?? false,
      defaultProps,
    };
  });

  return {
    name: metadata.name,
    label: metadata.label,
    description: metadata.description,
    defaultUrlPattern: metadata.defaultUrlPattern,
    components,
  };
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
