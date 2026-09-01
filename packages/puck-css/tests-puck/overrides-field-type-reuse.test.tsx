/**
 * Puck's `loadOverrides` writes each plugin's field wrapper straight into the
 * `fieldTypes` object it was handed. The editor keeps its overrides object
 * referentially stable, so a `fieldTypes` shared across reloads collects one
 * wrapper per reload and the plugin's control renders once per copy.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data, Plugin } from '@puckeditor/core';
import { createFieldGuidanceOverrides } from '../src/editor/plugin/fieldGuidance.js';
import { withFreshFieldTypes } from '../src/editor/freshFieldTypes.js';

const chromePlugin = {
  overrides: {
    fieldTypes: {
      text: ({ children }: { children?: React.ReactNode }) => (
        <div data-testid="feature-chrome">{children}</div>
      ),
    },
  },
} as unknown as Plugin;

const config = {
  root: {
    fields: {
      title: { type: 'text' as const, label: 'Title' },
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

describe('field type overrides across plugin reloads', () => {
  it('renders a plugin field wrapper once when Puck reloads its plugins', async () => {
    const overrides = withFreshFieldTypes(createFieldGuidanceOverrides());

    const editor = (
      <Puck
        config={config as never}
        data={data}
        iframe={{ enabled: false }}
        overrides={overrides as never}
        plugins={[chromePlugin]}
      />
    );

    const { container, rerender } = render(editor);
    await waitFor(() => {
      expect(container.querySelector('[name="title"]')).not.toBeNull();
    });

    // A new plugin array is all it takes for Puck to reload its overrides.
    rerender(
      <Puck
        config={config as never}
        data={data}
        iframe={{ enabled: false }}
        overrides={overrides as never}
        plugins={[chromePlugin]}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[name="title"]')).not.toBeNull();
    });

    const form = container.querySelector('form');
    if (!form) throw new Error('fields panel never rendered');
    expect(within(form as HTMLElement).getAllByTestId('feature-chrome')).toHaveLength(1);
  });
});
