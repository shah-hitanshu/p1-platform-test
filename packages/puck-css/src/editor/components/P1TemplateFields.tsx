import React from 'react';
import { createUsePuck } from '@puckeditor/core';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { TemplateDetailsPanel } from '../../features/content-type-templates/ui/TemplateDetailsPanel.js';
import { templateFromRegistryPath } from '../utils/templatePath.js';

const useTemplateFieldsPuck = createUsePuck();

/**
 * Right-sidebar fields override for template documents. When editing a template
 * (`_registry/templates/<name>`) with the root selected, replaces the default
 * "Page" root fields with the Template details panel (Label / Description / URL
 * pattern). Otherwise renders Puck's default fields unchanged.
 */
export function P1TemplateFields({ children }: { children: React.ReactNode }): React.ReactElement {
  const css = useP1PuckOptional();
  const itemSelector = useTemplateFieldsPuck(
    (s) =>
      (s as unknown as { appState?: { ui?: { itemSelector?: unknown } } }).appState?.ui?.itemSelector,
  );
  const dispatch = useTemplateFieldsPuck((s) => s.dispatch) as (action: unknown) => void;
  const template = templateFromRegistryPath(css?.currentDocument?.path, css?.templates);

  if (template && !itemSelector && css?.updateTemplate) {
    const updateTemplate = css.updateTemplate;
    return (
      <TemplateDetailsPanel
        template={template}
        onSave={async (details) => {
          await updateTemplate(template.id, {
            label: details.label,
            description: details.description,
            defaultUrlPattern: details.defaultUrlPattern,
          });
          dispatch({
            type: 'setData',
            data: (prev: Record<string, unknown>) => {
              const root = (prev.root ?? {}) as Record<string, unknown>;
              const props = (root.props ?? {}) as Record<string, unknown>;
              return {
                ...prev,
                root: {
                  ...root,
                  props: {
                    ...props,
                    _template: {
                      ...((props._template ?? {}) as Record<string, unknown>),
                      label: details.label,
                      description: details.description,
                      defaultUrlPattern: details.defaultUrlPattern,
                    },
                  },
                },
              };
            },
          } as never);
        }}
      />
    );
  }
  return <>{children}</>;
}
