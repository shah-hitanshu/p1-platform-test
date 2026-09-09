import z from 'zod';

export const MergeRequestStatusEnum = z.enum([
  'open',
  'approved',
  'merging',
  'conflicted',
  'merged',
  'closed',
]);

// 'merging' is execution-owned: valid in list filters and status reads, but
// the server rejects setting it — so the update tool doesn't advertise it.
export const SettableMergeRequestStatusEnum = z.enum([
  'open',
  'approved',
  'conflicted',
  'merged',
  'closed',
]);

export const ConflictStrategyEnum = z.enum(['take-source', 'take-target', 'manual']);

export const ConflictResolutionSchema = z.object({
  document_id: z.string().describe('The document ID (UUID) with the conflict'),
  strategy: ConflictStrategyEnum.describe(
    'take-source keeps the source workstream version, take-target keeps the target version, '
    + 'manual supplies a merged snapshot.',
  ),
  resolved_snapshot: z
    .record(z.unknown())
    .optional()
    .describe('The merged document snapshot. Required when strategy is "manual".'),
});

export const SiteIdInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
});

export const MergeBranchesInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  source_branch_id: z.string().describe('The workstream ID (UUID) holding the changes to merge'),
  target_branch_id: z.string().describe('The workstream ID (UUID) to merge into'),
});

export const MergeRequestIdInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_request_id: z.string().describe('The merge request ID (UUID)'),
});
