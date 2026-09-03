/**
 * Localization Puck Overrides
 *
 * Contributes the per-prop fields-panel controls via the fieldTypes override:
 * a single connected control per field renders the authority break/reset
 * control on a translation and the translatability toggle on the canonical
 * page. It reads the current document and client from P1 context at render
 * time, so the override is inert on documents that are neither.
 */

import React from 'react';
import type { P1FeaturePluginDeps } from '../../core/plugin-types.js';
import { AuthorityFieldControl } from './ui/AuthorityFieldControl.js';

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
  const localizedField = (props: FieldOverrideProps) => <AuthorityFieldControl {...props} />;

  return {
    // TODO(localization): v1 wraps text/textarea only. Extend the authority +
    // translatability controls to other field types (number, select, custom
    // date pickers, etc.) as appropriate.
    fieldTypes: {
      text: localizedField,
      textarea: localizedField,
    },
  };
}
