import {
  validateTranslationAuthority,
  type AuthorityDiagnostic,
} from '@pantheon-systems/p1-content-validator';
import type { McpApiClient } from '../../shared/api-client.js';
import { type EditOperationShape } from './shared-schemas.js';

/**
 * Diagnostics for writes to props this translation inherits from its canonical.
 * A document that is not a translation, an unreadable authority map, and a missing
 * snapshot all yield none: the warning is guidance, so losing it never blocks an
 * edit.
 */
export async function collectAuthorityWarnings(
  apiClient: McpApiClient,
  siteId: string,
  branchId: string,
  documentId: string | undefined,
  currentSnapshot: Record<string, unknown> | undefined,
  operations: EditOperationShape[],
): Promise<AuthorityDiagnostic[]> {
  if (documentId === undefined || currentSnapshot === undefined) {
    return [];
  }
  try {
    const authority = await apiClient.getTranslationAuthority(siteId, branchId, documentId);
    const { diagnostics } = validateTranslationAuthority({
      operations,
      currentSnapshot,
      templateSnapshot: undefined,
      slotAuthority: authority.slotDefaults,
      authorityOverrides: authority.authorityOverrides,
    });
    return diagnostics;
  } catch {
    return [];
  }
}

/** The warning block appended to a successful apply. */
export function formatAuthorityWarnings(diagnostics: AuthorityDiagnostic[]): string {
  const n = diagnostics.length;
  const lines = diagnostics
    .map((d) => `- ${d.slotId}.${d.propName} is owned by the canonical`)
    .join('\n');
  return (
    `\n\nAuthority warnings (${String(n)}):\n${lines}`
    + '\n\nThese props are inherited from the canonical. Edit them there and let sync '
    + 'propagate the value, unless you are reconciling the canonical\'s drift into this translation.'
  );
}
