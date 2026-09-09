/**
 * pds-toolkit's Icon looks its glyph up and dereferences the result unguarded
 * (`iconData[name].width`), so a name it does not ship throws a TypeError
 * during render. Unwrapped, that throw unmounts the whole editor — and it
 * repeats on every load of any document holding the offending block.
 *
 * The shared pds mock renders every icon as null, which cannot express that
 * failure, so this stubs an Icon that fails the way the real one does.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

const SHIPPED = new Set(['text', 'image']);

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Icon: ({ iconName }: { iconName: string }) => {
    if (!SHIPPED.has(iconName)) {
      throw new TypeError("Cannot read properties of undefined (reading 'width')");
    }
    return React.createElement('svg', { 'data-icon': iconName });
  },
}));

const { SafeIcon } = await import('./SafeIcon.js');

describe('SafeIcon', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a glyph the installed pds-toolkit ships', () => {
    const { container } = render(<SafeIcon iconName="text" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders nothing instead of throwing for a name it does not ship', () => {
    // React re-logs the caught error; silence it so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { container } = render(<SafeIcon iconName="link" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('keeps the rest of the tree mounted when the glyph is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { getByTestId } = render(
      <div data-testid="row">
        <SafeIcon iconName="squareDashed" />
        <span>Button</span>
      </div>,
    );
    expect(getByTestId('row').textContent).toBe('Button');
  });

  it('recovers when the name changes to one that is shipped', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { container, rerender } = render(<SafeIcon iconName="link" />);
    expect(container.querySelector('svg')).toBeNull();

    rerender(<SafeIcon iconName="image" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
