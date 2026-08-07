/**
 * Input schemas for the document route handlers
 */

import { z } from 'zod';
import { AUTHORITIES } from '@pantheon-systems/p1-content-validator';

/**
 * Bounds a slotId or propName, each of which becomes a key in the localization
 * edge's metadata JSONB.
 */
const MAX_OVERRIDE_KEY_LENGTH = 256;

const overrideKey = (field: string): z.ZodString =>
  z
    .string({ error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`)
    .max(MAX_OVERRIDE_KEY_LENGTH, `${field} must be at most ${String(MAX_OVERRIDE_KEY_LENGTH)} characters`);

const overrideTarget = z.object({
  slotId: overrideKey('slotId'),
  propName: overrideKey('propName'),
});

export const handleAuthorityOverridesValidation = {
  /** Clearing an override names the prop only. */
  clearBody: overrideTarget,
  /** Setting one also carries the authority to store. */
  setBody: overrideTarget.extend({
    authority: z.enum(AUTHORITIES, {
      error: `authority must be one of: ${AUTHORITIES.join(', ')}`,
    }),
  }),
};
