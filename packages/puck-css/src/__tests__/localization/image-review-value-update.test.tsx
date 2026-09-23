import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewValue } from '../../features/localization/ui/upstream-change-presentation.js';

afterEach(cleanup);

describe('localization image value updates', () => {
  it('attempts an image again after switching away and back', () => {
    const firstUrl = 'https://media.example.test/first.jpg';
    const view = render(<ReviewValue value={firstUrl} presentation="image" />);
    fireEvent.error(screen.getByRole('presentation'));

    view.rerender(
      <ReviewValue value="https://media.example.test/second.jpg" presentation="image" />,
    );
    view.rerender(<ReviewValue value={firstUrl} presentation="image" />);

    expect(screen.getByRole('presentation')).toHaveAttribute('src', firstUrl);
  });

  it('shows a new image after the previous image failed', () => {
    const view = render(
      <ReviewValue value="https://example.invalid/missing.jpg" presentation="image" />,
    );
    fireEvent.error(screen.getByRole('presentation'));

    view.rerender(
      <ReviewValue value="https://media.example.test/replacement.jpg" presentation="image" />,
    );

    expect(screen.getByRole('presentation')).toHaveAttribute(
      'src',
      'https://media.example.test/replacement.jpg',
    );
  });
});
