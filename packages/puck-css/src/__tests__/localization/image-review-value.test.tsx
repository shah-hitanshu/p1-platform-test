import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveFieldPresentation,
  type ChangeLabelConfig,
} from '../../features/localization/resolve-change-label.js';
import { ROOT_SLOT_ID } from '../../features/localization/prop-target.js';
import { ReviewValue } from '../../features/localization/ui/upstream-change-presentation.js';

afterEach(cleanup);

describe('localization image values', () => {
  const config: ChangeLabelConfig = {
    components: {
      MediaFigureBlock: {
        label: 'Media Figure',
        fields: {
          photo: { type: 'p1-media', label: 'Photo' },
        },
      },
      ImageBlock: {
        label: 'Image',
        fields: {
          src: { type: 'text', label: 'Image URL' },
        },
      },
      EmbedBlock: {
        label: 'Embed',
        fields: {
          src: { type: 'text', label: 'Embed URL' },
        },
      },
    },
  };

  it('identifies rich media fields and image-block source fields', () => {
    expect(resolveFieldPresentation(config, 'media-id', '/photo', 'MediaFigureBlock')).toBe('image');
    expect(resolveFieldPresentation(config, 'image-id', '/src', 'ImageBlock')).toBe('image');
    expect(resolveFieldPresentation(config, 'embed-id', '/src', 'EmbedBlock')).toBe('default');
  });

  it('identifies conventionally named basic image fields', () => {
    const basicConfig: ChangeLabelConfig = {
      root: {
        fields: {
          heroImageUrl: { type: 'text' },
          destinationUrl: { type: 'text' },
        },
      },
    };

    expect(resolveFieldPresentation(basicConfig, ROOT_SLOT_ID, '/heroImageUrl')).toBe('image');
    expect(resolveFieldPresentation(basicConfig, ROOT_SLOT_ID, '/destinationUrl')).toBe('default');
  });

  it('renders rich media as a thumbnail with its text details', () => {
    render(
      <ReviewValue
        value={{
          assetId: 'asset-1',
          versionId: 'version-1',
          url: 'https://media.example.test/photos/harbor.jpg',
          alt: 'Boats in a harbor',
        }}
        presentation="image"
      />,
    );

    const image = screen.getByRole('presentation');
    expect(image).toHaveAttribute('src', 'https://media.example.test/photos/harbor.jpg');
    expect(image).toHaveAttribute('alt', '');
    const details = screen.getByTestId('upstream-image-details');
    expect(details.children[0]).toHaveTextContent('Boats in a harbor');
    expect(details.children[1]).toHaveTextContent('harbor.jpg');
  });

  it('keeps a textual fallback when an image value has no usable URL', () => {
    render(<ReviewValue value={{ alt: 'Missing image' }} presentation="image" />);

    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    expect(screen.getByTestId('upstream-image-details')).toHaveTextContent('Missing image');
  });
});
