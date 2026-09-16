/**
 * `includeTombstoned` on listDocumentsOnBranch/countDocumentsOnBranch — lets
 * Site Structure request tombstoned rows explicitly, while every other
 * caller (public rendering, existing editor listing) keeps the default
 * exclusion.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  countDocumentsOnBranch,
  listDocumentsOnBranch,
} from '../../src/services/branch-document-service';

let stub: DatabaseStub;

beforeEach(() => {
  stub = stubDatabase();
});

describe('listDocumentsOnBranch includeTombstoned', () => {

  it('excludes tombstoned documents by default', async () => {
    await listDocumentsOnBranch('branch-1', {});

    const { sql } = stub.statements[0];
    expect(sql).toContain('top.is_tombstone = false');
  });

  it('omits the tombstone exclusion when includeTombstoned is true', async () => {
    await listDocumentsOnBranch('branch-1', { includeTombstoned: true });

    const { sql } = stub.statements[0];
    expect(sql).not.toContain('top.is_tombstone = false');
  });
});

describe('countDocumentsOnBranch includeTombstoned', () => {

  it('excludes tombstoned documents by default', async () => {
    await countDocumentsOnBranch('branch-1', {});

    const { sql } = stub.statements[0];
    expect(sql).toContain('is_tombstone = true');
  });

  it('omits the tombstone exclusion when includeTombstoned is true', async () => {
    await countDocumentsOnBranch('branch-1', { includeTombstoned: true });

    const { sql } = stub.statements[0];
    expect(sql).not.toContain('is_tombstone = true');
  });
});
