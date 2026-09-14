/**
 * Localization Puck Overrides
 *
 * Contributes the fieldTypes override that resolves the prop each field
 * addresses and offers it to the label row, where P1FieldLabel draws the glyph
 * that opens the prop's translation settings. The glyph reads the current
 * document and client from P1 context at render time, so it is inert on
 * documents that are neither a translation nor a canonical page.
 */

import React from 'react';
import type { P1FeaturePluginDeps } from '../../core/plugin-types.js';
import { LocalizationField } from './ui/LocalizationField.js';

interface FieldOverrideProps {
  children: React.ReactNode;
  name: string;
  id?: string;
  field?: { type?: string };
  readOnly?: boolean;
  onChange?: (value: unknown, ui?: unknown) => void;
  value?: unknown;
}

export function buildLocalizationOverrides(
  _deps: P1FeaturePluginDeps,
): Record<string, unknown> {
  const localizedField = (props: FieldOverrideProps) => <LocalizationField {...props} />;

  return {
    // TODO(localization): the control reaches the field types that hold prose.
    // Extend it to other field types (number, select, custom date pickers,
    // etc.) as appropriate.
    fieldTypes: {
      text: localizedField,
      textarea: localizedField,
      richtext: localizedField,
    },
  };
}
