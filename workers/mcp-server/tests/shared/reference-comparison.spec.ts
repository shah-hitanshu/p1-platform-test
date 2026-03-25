/**
 * Reference Comparison Tests
 *
 * Verifies remote tool definitions match the reference stdio server.
 */

import { describe, it, expect } from 'vitest';

describe('Reference Comparison', () => {
  // Test 27: Remote tool names match reference
  it('should have the same 11 tool names as the reference', async () => {
    const remote = await import('../../src/shared/tools.js');
    const remoteDefs = remote.getToolDefinitions();
    const remoteNames = remoteDefs.map((d) => d.name).sort();

    expect(remoteNames).toEqual([
      'abort_edit_session',
      'apply_document_edits',
      'check_edit_permission',
      'complete_edit_session',
      'get_branch_presence',
      'get_document',
      'get_document_presence',
      'list_branches',
      'list_documents',
      'list_sites',
      'start_edit_session',
    ]);
  });

  // Test 28: Remote schemas have same shape
  it('should export schemas for all 11 tools', async () => {
    const remote = await import('../../src/shared/tools.js');
    const schemaNames = Object.keys(remote.schemas).sort();

    expect(schemaNames).toEqual([
      'abort_edit_session',
      'apply_document_edits',
      'check_edit_permission',
      'complete_edit_session',
      'get_branch_presence',
      'get_document',
      'get_document_presence',
      'list_branches',
      'list_documents',
      'list_sites',
      'start_edit_session',
    ]);
  });
});
