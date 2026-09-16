/**
 * Every timestamp a document mapper reports is ISO-8601.
 *
 * The domain types declare these fields as strings and clients parse them as
 * ISO-8601. A statement run through db().execute() returns Postgres' own text
 * form instead, because the Drizzle client parses timestamp columns as
 * identity, so the mappers are what put the two back in agreement.
 */

import { describe, it, expect } from 'vitest';
import {
  mapRowToDocument,
  mapRowToDocumentOnBranch,
  mapRowToDocumentVersion,
  type DocumentOnBranchRow,
  type DocumentRow,
  type DocumentVersionRow,
} from '../../src/services/document-types';

/** What Postgres returns for a timestamptz when nothing parses it. */
const RAW = '2026-09-14 17:39:57.359838+00';
const ISO = '2026-09-14T17:39:57.359Z';

const documentRow: DocumentRow = {
  id: 'doc-1',
  site_id: 'site-1',
  path: 'pages/home',
  created_at: RAW,
  archived_at: RAW,
};

const onBranchRow: DocumentOnBranchRow = {
  ...documentRow,
  inherited: false,
  branch_path: null,
  published_version_id: 'version-1',
  published_at: RAW,
  is_tombstone: null,
  snapshot_title: null,
  latest_version_at: RAW,
  last_modified_by_id: null,
  last_modified_by_type: null,
  last_modified_by_name: null,
  last_modified_by_avatar_url: null,
};

const versionRow: DocumentVersionRow = {
  id: 'version-1',
  document_id: 'doc-1',
  branch_id: 'branch-1',
  version_number: 1,
  snapshot: {},
  source: 'edit',
  created_by_id: 'user-1',
  created_by_type: 'user',
  created_at: RAW,
};

describe('document timestamp reporting', () => {
  it('reports a document created and archived time as ISO-8601', () => {
    const doc = mapRowToDocument(documentRow);

    expect(doc.createdAt).toBe(ISO);
    expect(doc.archivedAt).toBe(ISO);
  });

  it('reports a branch listing published and updated time as ISO-8601', () => {
    const doc = mapRowToDocumentOnBranch(onBranchRow);

    expect(doc.createdAt).toBe(ISO);
    expect(doc.publishedAt).toBe(ISO);
    expect(doc.updatedAt).toBe(ISO);
  });

  it('reports a version created time as ISO-8601', () => {
    expect(mapRowToDocumentVersion(versionRow).createdAt).toBe(ISO);
  });

  it('leaves a timestamp the row does not carry unreported', () => {
    const doc = mapRowToDocument({ ...documentRow, archived_at: null });

    expect(doc.archivedAt).toBeUndefined();
  });
});
