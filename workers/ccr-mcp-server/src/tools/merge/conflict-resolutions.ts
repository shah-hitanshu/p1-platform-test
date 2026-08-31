import z from 'zod';
import { ConflictResolutionSchema } from './shared-schemas.js';

type ConflictResolutionInput = z.infer<typeof ConflictResolutionSchema>;

export interface ConflictResolution {
  documentId: string;
  strategy: 'take-source' | 'take-target' | 'manual';
  resolvedSnapshot?: Record<string, unknown>;
}

export function mapConflictResolutions(
  resolutions: ConflictResolutionInput[] | undefined,
): ConflictResolution[] | undefined {
  return resolutions?.map((r) => ({
    documentId: r.document_id,
    strategy: r.strategy,
    ...(r.resolved_snapshot !== undefined && { resolvedSnapshot: r.resolved_snapshot }),
  }));
}
