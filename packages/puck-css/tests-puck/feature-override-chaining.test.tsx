/**
 * Feature-plugin field overrides against real Puck.
 *
 * Puck accepts one renderer per field type, and a feature plugin's overrides
 * arrive as a plugin entry rather than being merged into the `overrides` prop.
 * What that buys is the thing proved here: the plugin's chrome and the base
 * help text both render around the same input, innermost last, instead of the
 * plugin's renderer taking the slot and dropping the help text.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data, Plugin } from '@puckeditor/core';
import { createFieldGuidanceOverrides } from '../src/editor/plugin/fieldGuidance.js';
import { collectPuckPlugins } from '../src/editor/composePlugins.js';
import { resolveFeatureConfig } from '../src/core/featureConfig.js';
import type { P1FeaturePlugin, P1FeaturePluginDeps } from '../src/core/plugin-types.js';

const deps = {
  client: {} as P1FeaturePluginDeps['client'],
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
  config: resolveFeatureConfig({}),
};

const decoratorPlugin: P1FeaturePlugin = {
  name: 'decorator',
  puckOverrides: () => ({
    fieldTypes: {
      text: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="feature-chrome">{children}</div>
      ),
    },
  }),
};

const config = {
  root: {
    fields: {
      title: {
        type: 'text' as const,
        label: 'Title',
        metadata: { help: 'Shown under the input' },
      },
    },
    render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  },
  components: {},
};

const data = {
  root: { props: { title: 'Q3 Launch Recap' } },
  content: [],
  zones: {},
} as unknown as Data;

const renderEditor = (plugins: Plugin[]) =>
  render(
    <Puck
      config={config as never}
      data={data}
      iframe={{ enabled: false }}
      overrides={createFieldGuidanceOverrides() as never}
      plugins={plugins}
    />,
  );

// Puck renders the fields panel twice in the DOM, so scope to the one this
// render owns.
const panel = (container: HTMLElement) => {
  const form = container.querySelector('form');
  if (!form) throw new Error('fields panel never rendered');
  return within(form as HTMLElement);
};

describe('feature plugin field overrides in Puck', () => {
  it('renders the plugin chrome, the base help text and the input together', async () => {
    const { container } = renderEditor(collectPuckPlugins([decoratorPlugin], deps) as Plugin[]);

    await waitFor(() => {
      expect(container.querySelector('[name="title"]')).not.toBeNull();
    });

    const scoped = panel(container);
    expect(scoped.getByTestId('feature-chrome')).toBeTruthy();
    expect(scoped.getByText('Shown under the input')).toBeTruthy();
    expect(scoped.getByTestId('feature-chrome').querySelector('[name="title"]')).not.toBeNull();
  });
});
