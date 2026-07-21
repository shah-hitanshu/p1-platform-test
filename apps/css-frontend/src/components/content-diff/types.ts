/**
 * Content-Oriented Diff Types
 *
 * Types for transforming JSON diff operations into human-readable
 * grouped content changes.
 */

import type { DiffOperation } from '../../types';

/**
 * A single field-level change in human-readable form.
 */
export interface ContentChange {
  /** The RFC 6902 operation type */
  type: DiffOperation['op'];
  /** The JSON Pointer path of the change */
  path: string;
  /** Human-readable label for the field (e.g. "Title", "Background Color") */
  label: string;
  /** The previous value (undefined for add operations) */
  oldValue?: unknown;
  /** The new value (undefined for remove operations) */
  newValue?: unknown;
}

/**
 * A group of related changes under a section heading.
 * For Puck data, this is typically a component. For generic JSON, it's a top-level key.
 */
export interface ContentSection {
  /** Human-readable section heading (e.g. "Heading Component", "Settings") */
  label: string;
  /** The Puck component type, if this section represents a Puck component */
  componentType?: string;
  /** The component index in the content array, if applicable */
  componentIndex?: number;
  /** The changes within this section */
  changes: ContentChange[];
}
