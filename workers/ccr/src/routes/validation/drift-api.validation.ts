/**
 * Input schemas for the branch drift route handlers
 */

import { z } from 'zod';
import { MAX_DRIFT_LIMIT } from '../../services/branch-drift-service';
import { RELATION_TYPES } from '../../services/change-summary-service';

export const handleDriftRoutesValidation = {
  query: z.object({
    relationType: z.enum(RELATION_TYPES).default('localization'),
    limit: z.coerce.number().int().min(1).max(MAX_DRIFT_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }),
};
