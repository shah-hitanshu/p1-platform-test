import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

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
    const { suffixedPath } = await import('../../src/services/duplicate-document-service');
    expect(suffixedPath('about', 2)).toBe('about-2');
    expect(suffixedPath('about/team', 3)).toBe('about/team-3');
    expect(suffixedPath('_registry/templates/blog', 2)).toBe('_registry/templates/blog-2');
  });

  it('replaces an existing numeric suffix rather than stacking one', async () => {
    const { suffixedPath, suffixedTitle } = await import('../../src/services/duplicate-document-service');
    expect(suffixedPath('about-2', 3)).toBe('about-3');
    expect(suffixedTitle('About-2', 3)).toBe('About-3');
  });

  it('hyphenates the title, matching the prototype', async () => {
    const { suffixedTitle } = await import('../../src/services/duplicate-document-service');
    expect(suffixedTitle('About', 3)).toBe('About-3');
  });

  it('is lossy on a legitimately numeric slug, as the prototype is', async () => {
    const { suffixedPath } = await import('../../src/services/duplicate-document-service');
    expect(suffixedPath('top-10', 2)).toBe('top-2');
  });
});

describe('duplicateDocument', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('copies a leaf page to the next free suffix', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    // findFreeSuffix: no taken paths
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    // insertCopy: document insert
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    // insertCopy: version insert
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    const result = await duplicateDocument(baseParams);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].path).toBe('about-2');
  });

  it("keeps the source's locale on the copy, without a localization edge", async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    const frenchDoc = { ...sourceDoc, path: 'about.fr', locale: 'fr' };
    vi.mocked(docService.getDocument).mockResolvedValueOnce(frenchDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([frenchDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] }); // findFreeSuffix
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ ...insertedDocRow, locale: 'fr' }] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] }); // version insert

    const result = await duplicateDocument(baseParams);

    expect(result.documents[0].locale).toBe('fr');
    // Only the document and version inserts run: no localization edge.
    expect(vi.mocked(db.query).mock.calls).toHaveLength(3);
    const [sql, values] = vi.mocked(db.query).mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('locale');
    expect(values).toContain('fr');
  });

  it('leaves a copy of an unlocalized document with no locale', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await duplicateDocument(baseParams);

    const [, values] = vi.mocked(db.query).mock.calls[1] as [string, unknown[]];
    expect(values[2]).toBeNull();
  });

  it('does not scope descendants with a trailing slash — normalizePath eats it', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await duplicateDocument({ ...baseParams, includeChildren: true });

    const [, options] = vi.mocked(branchDocService.listDocumentsOnBranch).mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ pathPrefix: 'about' }));
  });

  it('drops the source and same-prefix siblings from the descendant set', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([
      { id: 'doc-1', siteId: 'site-1', path: 'about', createdAt: 'x' },
      { id: 'doc-2', siteId: 'site-1', path: 'about/team', createdAt: 'x' },
      { id: 'doc-3', siteId: 'site-1', path: 'aboutus', createdAt: 'x' },
      { id: 'doc-4', siteId: 'site-1', path: 'about-2', createdAt: 'x' },
      { id: 'doc-5', siteId: 'site-1', path: 'about.fr', createdAt: 'x' },
    ] as never);
    // snapshots for source + 1 descendant (about/team)
    vi.mocked(versionService.getLatestDocumentVersionWithFallback)
      .mockResolvedValueOnce(sourceVersion as never)
      .mockResolvedValueOnce({ ...sourceVersion, version: { ...sourceVersion.version, documentId: 'doc-2' } } as never);
    // findFreeSuffix: about-2 taken (it's in the listing as a sibling, not a free path)
    // But since we check app.documents directly (query), about-3 is free
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'doc-4' }] }) // about-2 taken
      .mockResolvedValueOnce({ rows: [] }); // about-3 free
    // insertCopy for root
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ ...insertedDocRow, id: 'doc-copy-1', path: 'about-3' }] })
      .mockResolvedValueOnce({ rows: [] });
    // insertCopy for child
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ ...insertedDocRow, id: 'doc-copy-2', path: 'about-3/team' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await duplicateDocument({ ...baseParams, includeChildren: true });

    expect(result.documents.map((d) => d.path)).toEqual(['about-3', 'about-3/team']);
  });

  it('ignores descendants when includeChildren is false', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    const result = await duplicateDocument(baseParams);

    expect(result.documents).toHaveLength(1);
    // listDocumentsOnBranch is always called (to find the effective path) but
    // only once — not a second time to enumerate descendants.
    expect(vi.mocked(branchDocService.listDocumentsOnBranch)).toHaveBeenCalledTimes(1);
  });

  it('reconstructs a diff-only snapshot', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    // Return a version with no stored snapshot (diff-only)
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      ...sourceVersion,
      version: { ...sourceVersion.version, snapshot: null },
    } as never);
    vi.mocked(versionService.reconstructVersionSnapshot).mockResolvedValueOnce({
      root: { props: { title: 'About' } },
    });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await duplicateDocument(baseParams);

    expect(vi.mocked(versionService.reconstructVersionSnapshot)).toHaveBeenCalledWith('doc-1', 'branch-1', 4);
  });

  it('retitles the copy on root.props.title', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await duplicateDocument(baseParams);

    const versionInsert = vi.mocked(db.query).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('app.document_versions'),
    );
    expect(JSON.stringify(versionInsert?.[1])).toContain('About-2');
  });

  it('retitles a legacy snapshot on its top-level title key', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      ...sourceVersion,
      version: { ...sourceVersion.version, snapshot: { title: 'About' } },
    } as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await duplicateDocument(baseParams);

    const versionInsert = vi.mocked(db.query).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('app.document_versions'),
    );
    expect(JSON.stringify(versionInsert?.[1])).toContain('About-2');
  });

  it('suffixes a template label and clears its URL pattern', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    const templateDoc = { id: 'doc-1', siteId: 'site-1', path: '_registry/templates/blog', createdAt: 'x' };
    vi.mocked(docService.getDocument).mockResolvedValueOnce(templateDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([templateDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce({
      ...sourceVersion,
      version: {
        ...sourceVersion.version,
        snapshot: {
          root: { props: { _template: { label: 'Blog', defaultUrlPattern: '/blog/:slug' } } },
        },
      },
    } as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ ...insertedDocRow, path: '_registry/templates/blog-2' }],
    });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

    await duplicateDocument(baseParams);

    const versionInsert = vi.mocked(db.query).mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('app.document_versions'),
    );
    const written = JSON.stringify(versionInsert?.[1]);
    expect(written).toContain('Blog-2');
    expect(written).not.toContain('defaultUrlPattern":"');
  });

  it('carries the template edge onto each copy', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');

    const docWithTemplate = { ...sourceDoc, templateId: 'tpl-1', templateVersion: 3 };
    vi.mocked(docService.getDocument).mockResolvedValueOnce(docWithTemplate);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([docWithTemplate] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [insertedDocRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] }); // relation insert

    await duplicateDocument(baseParams);

    expect(vi.mocked(db.query)).toHaveBeenCalledWith(
      expect.stringContaining('app.document_relations'),
      expect.arrayContaining(['tpl-1']),
    );
  });

  it('rejects a subtree over the cap', async () => {
    const { duplicateDocument, MAX_DUPLICATE_DESCENDANTS } = await import('../../src/services/duplicate-document-service');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');
    const { DuplicateSubtreeTooLargeError } = await import('../../src/services/errors');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    // Return source + MAX+1 true descendants
    const manyDescendants = Array.from({ length: MAX_DUPLICATE_DESCENDANTS + 1 }, (_, i) => ({
      id: `child-${String(i)}`,
      siteId: 'site-1',
      path: `about/child-${String(i)}`,
      createdAt: 'x',
    }));
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([
      sourceDoc,
      ...manyDescendants,
    ] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);

    await expect(
      duplicateDocument({ ...baseParams, includeChildren: true }),
    ).rejects.toBeInstanceOf(DuplicateSubtreeTooLargeError);
  });

  it('gives up after 50 taken suffixes', async () => {
    const { duplicateDocument } = await import('../../src/services/duplicate-document-service');
    const db = await import('../../src/db');
    const docService = await import('../../src/services/document-service');
    const versionService = await import('../../src/services/document-version-service');
    const branchDocService = await import('../../src/services/branch-document-service');
    const { PathAllocationExhaustedError } = await import('../../src/services/errors');

    vi.mocked(docService.getDocument).mockResolvedValueOnce(sourceDoc);
    vi.mocked(branchDocService.listDocumentsOnBranch).mockResolvedValueOnce([sourceDoc] as never);
    vi.mocked(versionService.getLatestDocumentVersionWithFallback).mockResolvedValueOnce(sourceVersion as never);
    // Every candidate comes back occupied
    vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'blocker' }] });

    await expect(duplicateDocument(baseParams)).rejects.toBeInstanceOf(PathAllocationExhaustedError);
  });
});
