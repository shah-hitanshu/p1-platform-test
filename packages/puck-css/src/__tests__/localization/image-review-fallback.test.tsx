import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveFieldPresentation,
  type ChangeLabelConfig,
} from '../../features/localization/resolve-change-label.js';
import { ReviewValue } from '../../features/localization/ui/upstream-change-presentation.js';

afterEach(cleanup);

describe('localization image preview fallback', () => {
  it('keeps non-image media component sources as text', () => {
    const config: ChangeLabelConfig = {
      components: {
        MediaEmbedBlock: {
          label: 'Media embed',
          fields: { src: { type: 'text' } },
        },
      },
    };

    expect(resolveFieldPresentation(config, 'embed-id', '/src', 'MediaEmbedBlock')).toBe('default');
  });

  it('removes a failed thumbnail and retains its text details', () => {
    render(
      <ReviewValue
        value="https://media.example.test/missing.jpg"
        presentation="image"
      />,
    );

    fireEvent.error(screen.getByRole('presentation'));

    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    expect(screen.getByTestId('upstream-image-details')).toHaveTextContent('missing.jpg');
  });
});
