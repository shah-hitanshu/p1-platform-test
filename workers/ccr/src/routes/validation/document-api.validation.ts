/**
 * Input schemas for the document route handlers
 */

import { z } from 'zod';
import { AUTHORITIES } from '@pantheon-systems/p1-content-validator';
import { TRANSLATION_MODES } from '../../services/create-translation-service';

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

/**
 * Ceiling on how many changes one request settles, so a single statement stays
 * bounded and a first write cannot reach `MAX_OVERRIDE_ENTRIES`.
 */
const MAX_RESOLUTION_TARGETS = 100;

const resolutionTargets = z
  .array(
    z.object({
      slotId: overrideKey('slotId'),
      propPath: overrideKey('propPath'),
    }),
  )
  .min(1, 'targets must name at least one change')
  .max(
    MAX_RESOLUTION_TARGETS,
    `targets must name at most ${String(MAX_RESOLUTION_TARGETS)} changes`,
  );

export const handleUpstreamResolutionsValidation = {
  /**
   * Recording names the changes to settle and the canonical version the caller was
   * shown them at. The version comes from the request so that what gets settled is
   * the state the caller saw: a change the canonical made after that stays
   * outstanding. It names the version by identity, which resolves the same read
   * from any branch — a branch that has not edited the canonical is shown the
   * version it inherits from main.
   */
  put: z.object({
    targets: resolutionTargets,
    upstreamVersionId: z.uuid({ error: 'upstreamVersionId must name a version' }),
  }),
  /** Clearing names only the changes, since no version is being recorded. */
  delete: z.object({ targets: resolutionTargets }),
};

export const handleCreateDocumentValidation = {
  /**
   * Creating a document names a path, and optionally the language its content is
   * written in. The locale is checked for shape here so a non-string reaches the
   * language-tag parser as a 400 rather than a TypeError; whether the tag names a
   * real language is the service's call.
   */
  body: z
    .object({
      path: z
        .string({ error: 'path is required' })
        .trim()
        .min(1, 'path is required'),
      title: z.string().optional(),
      locale: z.string().trim().min(1, 'locale must not be empty').optional(),
      snapshot: z.record(z.string(), z.unknown()).optional(),
      templateId: z.string().optional(),
      templateVersion: z.number().optional(),
    })
    .loose(),
};

export const handleCreateTranslationValidation = {
  /**
   * Creating a translation names the locale, optionally a path, and optionally the
   * mode its content is seeded with. An unimplemented mode is refused here rather
   * than defaulted, so a caller asking for content the backend cannot produce
   * learns so instead of receiving a copy.
   */
  body: z.object({
    locale: z
      .string({ error: 'locale is required' })
      .trim()
      .min(1, 'locale is required'),
    path: z.string().trim().min(1, 'path must not be empty').optional(),
    mode: z
      .enum(TRANSLATION_MODES, {
        error: `mode must be one of: ${TRANSLATION_MODES.join(', ')}`,
      })
      .optional(),
  }),
};

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
