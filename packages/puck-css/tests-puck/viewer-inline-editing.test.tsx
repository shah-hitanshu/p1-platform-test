/**
 * A viewer must not be able to type directly into the canvas. Puck gates inline
 * editing on the field's contentEditable, never on permissions.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { richtextField } from '../src/data/fields.js';

function makeConfig(contentEditable: boolean) {
  return {
    root: {
      render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    },
    components: {
      Para: {
        fields: {
          body: contentEditable ? richtextField : { ...richtextField, contentEditable: false },
        },
        render: ({ body }: { body?: string }) => <div>{body}</div>,
      },
    },
  };
}

const data: Data = {
  root: { props: {} },
  content: [{ type: 'Para', props: { id: 'p1', body: 'hello' } }],
  zones: {},
};

describe('viewer inline editing', () => {
  it('renders a contenteditable richtext field for an editor', async () => {
    const { container } = render(
      <Puck config={makeConfig(true) as never} data={data} iframe={{ enabled: false }} />,
    );
    await waitFor(() => {
      const el = container.querySelector('[contenteditable]');
      expect(el).not.toBeNull();
    });
  });

  it('renders a non-contenteditable richtext field for a viewer', async () => {
    const { container } = render(
      <Puck config={makeConfig(false) as never} data={data} iframe={{ enabled: false }} />,
    );
    // Give Puck time to render — then assert no contenteditable element exists.
    await waitFor(() => {
      expect(container.querySelector('.puck-root') ?? container.querySelector('[data-testid]') ?? container.firstElementChild).not.toBeNull();
    });
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  });
});
