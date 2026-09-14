/**
 * Localization Field Override
 *
 * Puck tells a fieldTypes override which prop a field addresses but hands it the
 * whole labelled field; the label row is rendered by the label override, which
 * is told only the label text. So this half resolves the prop and puts it on
 * context, and P1FieldLabel reads that context to mark the label row.
 */

import React from 'react';
import { resolvePropTarget } from '../prop-target.js';
import { FieldTargetProvider } from './field-target-context.js';

interface LocalizationFieldProps {
  children: React.ReactNode;
  name: string;
  id?: string;
  field?: { type?: string };
}

export function LocalizationField({
  children,
  name,
  id,
  field,
}: LocalizationFieldProps): React.ReactElement {
  return (
    <FieldTargetProvider target={resolvePropTarget(id, field?.type, name)}>
      {children}
    </FieldTargetProvider>
  );
}
