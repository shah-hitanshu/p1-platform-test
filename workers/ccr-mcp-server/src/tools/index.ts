/**
 * The tool registry: one entry per tool, keyed by the name it is registered
 * under. Domains that have moved out of shared/tools.ts contribute here; the
 * derived maps below replace the hand-maintained parallel lists that used to
 * live beside the handlers.
 */

import { branchTools } from './branches/index.js';
import { dataTools } from './data/index.js';
import { documentTools } from './documents/index.js';
import { editingTools } from './editing/index.js';
import { localizationTools } from './localization/index.js';
import { mergeTools } from './merge/index.js';
import { metadataTools } from './metadata/index.js';
import { navigationTools } from './navigation/index.js';
import { presenceTools } from './presence/index.js';
import { registryTools } from './registry/index.js';
import { siteTools } from './sites/index.js';
import { versionTools } from './versions/index.js';

export const allTools = {
  ...siteTools,
  ...branchTools,
  ...documentTools,
  ...mergeTools,
  ...navigationTools,
  ...versionTools,
  ...localizationTools,
  ...presenceTools,
  ...registryTools,
  ...metadataTools,
  ...dataTools,
  ...editingTools,
};

export type ToolName = keyof typeof allTools;

/** Zod input schema per tool, for MCP registration. */
export const schemas = Object.fromEntries(
  Object.entries(allTools).map(([name, tool]) => [name, tool.inputSchema]),
);

/** Tools that mutate backend state, and so take the tighter rate limiter. */
export const mutationTools = new Set(
  Object.entries(allTools)
    .filter(([, tool]) => tool.mutates)
    .map(([name]) => name),
);
