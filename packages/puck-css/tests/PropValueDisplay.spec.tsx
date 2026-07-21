/**
 * PropValueDisplay Component Tests
 *
 * Tests for the smart prop value renderer that displays
 * different prop types appropriately (colors, text, booleans, etc.)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropValueDisplay } from '../src/versioning/components/version-compare/PropValueDisplay.js';

describe('PropValueDisplay', () => {
  describe('string values', () => {
    it('should render short strings inline', () => {
      render(<PropValueDisplay value="Hello World" />);
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('should truncate long strings', () => {
      const longText = 'A'.repeat(100);
      render(<PropValueDisplay value={longText} maxLength={50} />);
      expect(screen.getByText(/A{50}…/)).toBeInTheDocument();
    });

    it('should render empty string as (empty)', () => {
      render(<PropValueDisplay value="" />);
      expect(screen.getByText('(empty)')).toBeInTheDocument();
    });
  });

  describe('color values', () => {
    it('should render hex colors with swatch', () => {
      render(<PropValueDisplay value="#ff0000" />);
      const swatch = document.querySelector('.prop-value-color-swatch');
      expect(swatch).toBeInTheDocument();
      expect(swatch).toHaveStyle({ backgroundColor: '#ff0000' });
      expect(screen.getByText('#ff0000')).toBeInTheDocument();
    });

    it('should render rgb colors with swatch', () => {
      render(<PropValueDisplay value="rgb(255, 0, 0)" />);
      const swatch = document.querySelector('.prop-value-color-swatch');
      expect(swatch).toBeInTheDocument();
    });

    it('should render rgba colors with swatch', () => {
      render(<PropValueDisplay value="rgba(255, 0, 0, 0.5)" />);
      const swatch = document.querySelector('.prop-value-color-swatch');
      expect(swatch).toBeInTheDocument();
    });
  });

  describe('number values', () => {
    it('should render numbers', () => {
      render(<PropValueDisplay value={42} />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should render decimal numbers', () => {
      render(<PropValueDisplay value={3.14159} />);
      expect(screen.getByText('3.14159')).toBeInTheDocument();
    });

    it('should render zero', () => {
      render(<PropValueDisplay value={0} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('boolean values', () => {
    it('should render true with checkmark', () => {
      render(<PropValueDisplay value={true} />);
      expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('should render false with x mark', () => {
      render(<PropValueDisplay value={false} />);
      expect(screen.getByText('✗')).toBeInTheDocument();
    });
  });

  describe('null/undefined values', () => {
    it('should render null', () => {
      render(<PropValueDisplay value={null} />);
      expect(screen.getByText('null')).toBeInTheDocument();
    });

    it('should render undefined', () => {
      render(<PropValueDisplay value={undefined} />);
      expect(screen.getByText('undefined')).toBeInTheDocument();
    });
  });

  describe('array values', () => {
    it('should render array summary', () => {
      render(<PropValueDisplay value={['a', 'b', 'c']} />);
      expect(screen.getByText('[3 items]')).toBeInTheDocument();
    });

    it('should render empty array', () => {
      render(<PropValueDisplay value={[]} />);
      expect(screen.getByText('[0 items]')).toBeInTheDocument();
    });
  });

  describe('object values', () => {
    it('should render object summary', () => {
      render(<PropValueDisplay value={{ foo: 'bar', baz: 123 }} />);
      expect(screen.getByText('{2 keys}')).toBeInTheDocument();
    });

    it('should render empty object', () => {
      render(<PropValueDisplay value={{}} />);
      expect(screen.getByText('{0 keys}')).toBeInTheDocument();
    });
  });

  describe('diff mode', () => {
    it('should apply added styling', () => {
      const { container } = render(<PropValueDisplay value="new" diffType="added" />);
      expect(container.firstChild).toHaveClass('prop-value--added');
    });

    it('should apply removed styling', () => {
      const { container } = render(<PropValueDisplay value="old" diffType="removed" />);
      expect(container.firstChild).toHaveClass('prop-value--removed');
    });

    it('should apply modified styling', () => {
      const { container } = render(<PropValueDisplay value="changed" diffType="modified" />);
      expect(container.firstChild).toHaveClass('prop-value--modified');
    });
  });
});
