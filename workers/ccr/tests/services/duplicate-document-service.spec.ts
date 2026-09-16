import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentRelations, documentVersions, documents } from '../../src/db/schema';
import {
  duplicateDocument,
  suffixedPath,
  suffixedTitle,
  MAX_DUPLICATE_DESCENDANTS,
} from '../../src/services/duplicate-document-service';
import { getDocument } from '../../src/services/document-service';
import {
  getLatestDocumentVersionWithFallback,
  reconstructVersionSnapshot,
} from '../../src/services/document-version-service';
import { listDocumentsOnBranch } from '../../src/services/branch-document-service';
import {
  DuplicateSubtreeTooLargeError,
  PathAllocationExhaustedError,
} from '../../src/services/errors';

vi.mock('../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

vi.mock('../../src/services/document-version-service', () => ({
  getLatestDocumentVersionWithFallback: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

vi.mock('../../src/services/branch-document-service', () => ({
  listDocumentsOnBranch: vi.fn(),
}));

const baseParams = {
  documentId: 'doc-1',
  branchId: 'branch-1',
  siteId: 'site-1',
  includeChildren: false,
  createdById: 'user-1',
  createdByType: 'user' as const,
};

const sourceDoc = {
  id: 'doc-1',
  siteId: 'site-1',
  path: 'about',
  createdAt: '2026-01-01T00:00:00Z',
};

const sourceVersion = {
  version: {
    id: 'ver-1',
    documentId: 'doc-1',
    branchId: 'branch-1',
    versionNumber: 4,
    snapshot: {
      root: { props: { title: 'About' } },
    },
    source: 'edit',
    createdById: 'user-1',
    createdByType: 'user',
    createdAt: '2026-01-01T00:00:00Z',
  },
  inherited: false,
};

const insertedDocRow = {
  id: 'doc-copy-1',
  site_id: 'site-1',
  path: 'about-2',
  created_at: '2026-01-01T00:00:00Z',
  archived_at: null,
};


describe('suffix rules', () => {
  it('appends the suffix to the last segment only', async () => {
    expect(suffixedPath('about', 2)).toBe('about-2');
    expect(suffixedPath('about/team', 3)).toBe('about/team-3');
    expect(suffixedPath('_registry/templates/blog', 2)).toBe('_registry/templates/blog-2');
  });

  it('replaces an existing numeric suffix rather than stacking one', async () => {
    expect(suffixedPath('about-2', 3)).toBe('about-3');
    expect(suffixedTitle('About-2', 3)).toBe('About-3');
  });

  it('hyphenates the title, matching the prototype', async () => {
    expect(suffixedTitle('About', 3)).toBe('About-3');
  });

  it('is lossy on a legitimately numeric slug, as the prototype is', async () => {
    expect(suffixedPath('top-10', 2)).toBe('top-2');
  });
});

describe('duplicateDocument', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  it('copies a leaf page to the next free suffix', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    const result = await duplicateDocument(baseParams);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].path).toBe('about-2');
  });

  it("keeps the source's locale on the copy, without a localization edge", async () => {

    const frenchDoc = { ...sourceDoc, path: 'about.fr', locale: 'fr' };
    vi.mocked(getDocument).mockResolvedValueOnce(frenchDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([frenchDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([{ ...insertedDocRow, locale: 'fr' }]);

    const result = await duplicateDocument(baseParams);

    expect(result.documents[0].locale).toBe('fr');
    // A copy carries the locale but no localization edge: it is a sibling of
    // the source, not a translation of it.
    expect(stub.calls(documentRelations).insert).toEqual([]);
    const [insert] = stub.calls(documents).insert;
    expect(insert.sql).toContain('locale');
    expect(insert.params).toContain('fr');
  });

  it('leaves a copy of an unlocalized document with no locale', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    await duplicateDocument(baseParams);

    const { params: values } = stub.calls(documents).insert[0];
    expect(values[2]).toBeNull();
  });

  it('does not scope descendants with a trailing slash — normalizePath eats it', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    await duplicateDocument({ ...baseParams, includeChildren: true });

    const [, options] = vi.mocked(listDocumentsOnBranch).mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ pathPrefix: 'about' }));
  });

  it('drops the source and same-prefix siblings from the descendant set', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([
      { id: 'doc-1', siteId: 'site-1', path: 'about', createdAt: 'x' },
      { id: 'doc-2', siteId: 'site-1', path: 'about/team', createdAt: 'x' },
      { id: 'doc-3', siteId: 'site-1', path: 'aboutus', createdAt: 'x' },
      { id: 'doc-4', siteId: 'site-1', path: 'about-2', createdAt: 'x' },
      { id: 'doc-5', siteId: 'site-1', path: 'about.fr', createdAt: 'x' },
    ] as never);
    // snapshots for source + 1 descendant (about/team)
    vi.mocked(getLatestDocumentVersionWithFallback)
      .mockResolvedValueOnce(sourceVersion as never)
      .mockResolvedValueOnce({ ...sourceVersion, version: { ...sourceVersion.version, documentId: 'doc-2' } } as never);
    // about-2 is occupied and about-3 is free, so the subtree lands on about-3.
    stub.on(documents).select.whenBound(['about-2']).returnsRaw([{ id: 'doc-4' }]);
    stub.on(documents).insert
      .whenBound(['about-3'])
      .returnsRaw([{ ...insertedDocRow, id: 'doc-copy-1', path: 'about-3' }]);
    stub.on(documents).insert
      .whenBound(['about-3/team'])
      .returnsRaw([{ ...insertedDocRow, id: 'doc-copy-2', path: 'about-3/team' }]);

    const result = await duplicateDocument({ ...baseParams, includeChildren: true });

    expect(result.documents.map((d) => d.path)).toEqual(['about-3', 'about-3/team']);
  });

  it('ignores descendants when includeChildren is false', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    const result = await duplicateDocument(baseParams);

    expect(result.documents).toHaveLength(1);
    // listDocumentsOnBranch is always called (to find the effective path) but
    // only once — not a second time to enumerate descendants.
    expect(vi.mocked(listDocumentsOnBranch)).toHaveBeenCalledTimes(1);
  });

  it('reconstructs a diff-only snapshot', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    // Return a version with no stored snapshot (diff-only)
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      ...sourceVersion,
      version: { ...sourceVersion.version, snapshot: null },
    } as never);
    vi.mocked(reconstructVersionSnapshot).mockResolvedValueOnce({
      root: { props: { title: 'About' } },
    });
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    await duplicateDocument(baseParams);

    expect(vi.mocked(reconstructVersionSnapshot)).toHaveBeenCalledWith('doc-1', 'branch-1', 4);
  });

  it('retitles the copy on root.props.title', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    await duplicateDocument(baseParams);

    const [versionInsert] = stub.calls(documentVersions).insert;
    expect(JSON.stringify(versionInsert.params)).toContain('About-2');
  });

  it('retitles a legacy snapshot on its top-level title key', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      ...sourceVersion,
      version: { ...sourceVersion.version, snapshot: { title: 'About' } },
    } as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);

    await duplicateDocument(baseParams);

    const [versionInsert] = stub.calls(documentVersions).insert;
    expect(JSON.stringify(versionInsert.params)).toContain('About-2');
  });

  it('suffixes a template label and clears its URL pattern', async () => {

    const templateDoc = { id: 'doc-1', siteId: 'site-1', path: '_registry/templates/blog', createdAt: 'x' };
    vi.mocked(getDocument).mockResolvedValueOnce(templateDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([templateDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      ...sourceVersion,
      version: {
        ...sourceVersion.version,
        snapshot: {
          root: { props: { _template: { label: 'Blog', defaultUrlPattern: '/blog/:slug' } } },
        },
      },
    } as never);
    stub.on(documents).insert.returnsRaw([{ ...insertedDocRow, path: '_registry/templates/blog-2' }]);

    await duplicateDocument(baseParams);

    const [versionInsert] = stub.calls(documentVersions).insert;
    const written = JSON.stringify(versionInsert.params);
    expect(written).toContain('Blog-2');
    expect(written).not.toContain('defaultUrlPattern":"');
  });

  it('carries the template edge onto each copy', async () => {

    const docWithTemplate = { ...sourceDoc, templateId: 'tpl-1', templateVersion: 3 };
    vi.mocked(getDocument).mockResolvedValueOnce(docWithTemplate);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([docWithTemplate] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    stub.on(documents).insert.returnsRaw([insertedDocRow]);
    await duplicateDocument(baseParams);

    const [edgeInsert] = stub.calls(documentRelations).insert;
    expect(edgeInsert.params).toEqual(expect.arrayContaining(['tpl-1']));
  });

  it('rejects a subtree over the cap', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    // Return source + MAX+1 true descendants
    const manyDescendants = Array.from({ length: MAX_DUPLICATE_DESCENDANTS + 1 }, (_, i) => ({
      id: `child-${String(i)}`,
      siteId: 'site-1',
      path: `about/child-${String(i)}`,
      createdAt: 'x',
    }));
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([
      sourceDoc,
      ...manyDescendants,
    ] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);

    await expect(
      duplicateDocument({ ...baseParams, includeChildren: true }),
    ).rejects.toBeInstanceOf(DuplicateSubtreeTooLargeError);
  });

  it('gives up after 50 taken suffixes', async () => {

    vi.mocked(getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    // Every candidate comes back occupied
    stub.on(documents).select.returnsRaw([{ id: 'blocker' }]);

    await expect(duplicateDocument(baseParams)).rejects.toBeInstanceOf(PathAllocationExhaustedError);
  });
});
