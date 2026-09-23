import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  resolveFieldType,
  type ChangeLabelConfig,
} from '../../features/localization/resolve-change-label.js';
import {
  ReviewValue,
  structuralDescription,
  structuralSummary,
} from '../../features/localization/ui/upstream-change-presentation.js';
import { ROOT_SLOT_ID } from '../../features/localization/prop-target.js';

describe('upstream change presentation', () => {
  it('identifies a nested rich-text field from its Puck config', () => {
    const config: ChangeLabelConfig = {
      root: {
        fields: {
          cards: {
            type: 'array',
            arrayFields: {
              body: { type: 'richtext' },
            },
          },
        },
      },
    };

    expect(resolveFieldType(config, ROOT_SLOT_ID, '/cards/0/body')).toBe('richtext');
    expect(resolveFieldType(config, ROOT_SLOT_ID, '/cards/0/missing')).toBeUndefined();
  });

  it('counts changed blocks with singular and plural grammar', () => {
    expect(structuralSummary(1, 'source')).toBe(
      '1 block changed in the source version used for this localization.',
    );
    expect(structuralSummary(7, 'source')).toBe(
      '7 blocks changed in the source version used for this localization.',
    );
  });

  it('describes each structural operation without repeating the block name', () => {
    expect(structuralDescription('added', 'source')).toEqual({
      prefix: 'New ',
      suffix: ' block added to the source page. Reconcile this on the canvas.',
    });
    expect(structuralDescription('removed', 'source')).toEqual({
      prefix: '',
      suffix: ' block was removed from the source page. Reconcile this on the canvas.',
    });
    expect(structuralDescription('moved', 'template')).toEqual({
      prefix: '',
      suffix: ' block was moved on the template page. Reconcile this on the canvas.',
    });
  });

  it('shows rich-text markup literally in a code element', () => {
    render(<ReviewValue value={'<p>Hello</p>'} richtext />);

    const value = screen.getByTestId('upstream-richtext-value');
    expect(value.tagName).toBe('CODE');
    expect(value).toHaveTextContent('<p>Hello</p>');
    expect(value.querySelector('p')).toBeNull();
  });
});
