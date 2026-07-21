/**
 * PropValueDisplay Component
 *
 * Smart renderer for prop values that displays different types appropriately:
 * - Colors: Shows color swatch with hex/rgb value
 * - Strings: Inline text with truncation for long values
 * - Numbers: Numeric display
 * - Booleans: Checkmark or X icon
 * - Arrays: Summary with item count
 * - Objects: Summary with key count
 */

import React from 'react';

export interface PropValueDisplayProps {
  /**
   * The value to display.
   */
  value: unknown;

  /**
   * Maximum length for string values before truncation.
   * @default 80
   */
  maxLength?: number;

  /**
   * Diff type for styling (added, removed, modified).
   */
  diffType?: 'added' | 'removed' | 'modified';

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Checks if a string value represents a color.
 */
function isColorValue(value: string): boolean {
  // Hex colors
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return true;
  }
  // RGB/RGBA colors
  if (/^rgba?\s*\([\d\s,%.]+\)$/i.test(value)) {
    return true;
  }
  // HSL/HSLA colors
  if (/^hsla?\s*\([\d\s,%deg.]+\)$/i.test(value)) {
    return true;
  }
  return false;
}

/**
 * Renders a color value with swatch.
 */
function ColorValue({ value }: { value: string }): React.ReactElement {
  return (
    <span className="prop-value-color">
      <span
        className="prop-value-color-swatch"
        style={{ backgroundColor: value }}
        aria-hidden="true"
      />
      <span className="prop-value-color-text">{value}</span>
    </span>
  );
}

/**
 * Renders a string value with optional truncation.
 */
function StringValue({
  value,
  maxLength,
}: {
  value: string;
  maxLength: number;
}): React.ReactElement {
  if (value === '') {
    return <span className="prop-value-empty">(empty)</span>;
  }

  if (value.length > maxLength) {
    return (
      <span className="prop-value-string prop-value-string--truncated">
        {value.slice(0, maxLength)}…
      </span>
    );
  }

  return <span className="prop-value-string">{value}</span>;
}

/**
 * Smart prop value display component.
 */
export function PropValueDisplay({
  value,
  maxLength = 80,
  diffType,
  className = '',
}: PropValueDisplayProps): React.ReactElement {
  const baseClass = 'prop-value';
  const diffClass = diffType ? `${baseClass}--${diffType}` : '';
  const classes = [baseClass, diffClass, className].filter(Boolean).join(' ');

  // Null/undefined
  if (value === null) {
    return <span className={classes}>null</span>;
  }
  if (value === undefined) {
    return <span className={classes}>undefined</span>;
  }

  // Boolean
  if (typeof value === 'boolean') {
    return (
      <span className={`${classes} prop-value-boolean`}>
        {value ? '✓' : '✗'}
      </span>
    );
  }

  // Number
  if (typeof value === 'number') {
    return (
      <span className={`${classes} prop-value-number`}>
        {String(value)}
      </span>
    );
  }

  // String (check for color first)
  if (typeof value === 'string') {
    if (isColorValue(value)) {
      return (
        <span className={classes}>
          <ColorValue value={value} />
        </span>
      );
    }
    return (
      <span className={classes}>
        <StringValue value={value} maxLength={maxLength} />
      </span>
    );
  }

  // Array
  if (Array.isArray(value)) {
    return (
      <span className={`${classes} prop-value-array`}>
        [{value.length} items]
      </span>
    );
  }

  // Object
  if (typeof value === 'object') {
    const keyCount = Object.keys(value as Record<string, unknown>).length;
    return (
      <span className={`${classes} prop-value-object`}>
        {'{' + keyCount + ' keys}'}
      </span>
    );
  }

  // Fallback for any other type
  return <span className={classes}>{String(value)}</span>;
}
