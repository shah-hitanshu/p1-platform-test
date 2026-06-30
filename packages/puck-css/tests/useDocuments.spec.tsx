/**
 * useDocuments Hook Tests
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDocuments } from '../src/editor/useDocuments.js';
import type { P1Client } from '@pantheon-systems/css-client';

describe('useDocuments', () => {
  const mockClient = {
    documents: {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    versions: {
      create: vi.fn(),
    },
  } as unknown as P1Client;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('branch switching race condition', () => {
    it('should reset documents and loading state synchronously when branchId changes', async () => {
      // Set up mock to return different documents for different branches
      const branch1Docs = [{ id: 'doc1', path: 'page1' }];
      const branch2Docs = [{ id: 'doc2', path: 'page2' }];

      (mockClient.documents.list as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(branch1Docs)
        .mockResolvedValueOnce(branch2Docs);

      // Start with branch1
      const { result, rerender } = renderHook(
        ({ branchId }) =>
          useDocuments({
            client: mockClient,
            siteId: 'site1',
            branchId,
          }),
        { initialProps: { branchId: 'branch1' } }
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.documents).toEqual(branch1Docs);

      // Switch to branch2
      rerender({ branchId: 'branch2' });

      // CRITICAL: Documents should be cleared and loading should be true IMMEDIATELY
      // This prevents the race condition where old documents are used with new branchId
      expect(result.current.documents).toEqual([]);
      expect(result.current.loading).toBe(true);

      // Wait for new documents to load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.documents).toEqual(branch2Docs);
    });

    it('should clear error state when branchId changes', async () => {
      const error = new Error('Test error');

      (mockClient.documents.list as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce([]);

      const { result, rerender } = renderHook(
        ({ branchId }) =>
          useDocuments({
            client: mockClient,
            siteId: 'site1',
            branchId,
          }),
        { initialProps: { branchId: 'branch1' } }
      );

      // Wait for error
      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      expect(result.current.error?.message).toBe('Test error');

      // Switch branch - error should be cleared
      rerender({ branchId: 'branch2' });

      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
    });
  });

  describe('initial loading', () => {
    it('should start with loading true', () => {
      (mockClient.documents.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { result } = renderHook(() =>
        useDocuments({
          client: mockClient,
          siteId: 'site1',
          branchId: 'branch1',
        })
      );

      expect(result.current.loading).toBe(true);
      expect(result.current.documents).toEqual([]);
    });

    it('should not fetch if branchId is empty', async () => {
      const { result } = renderHook(() =>
        useDocuments({
          client: mockClient,
          siteId: 'site1',
          branchId: '',
        })
      );

      // Give time for any potential fetch
      await new Promise((r) => setTimeout(r, 50));

      expect(mockClient.documents.list).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(true);
    });
  });

  describe('document operations', () => {
    it('should create a document and refresh the list', async () => {
      const existingDocs = [{ id: 'doc1', path: 'page1' }];
      const newDoc = { id: 'doc2', path: 'page2' };
      const updatedDocs = [...existingDocs, newDoc];

      (mockClient.documents.list as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(existingDocs)
        .mockResolvedValueOnce(updatedDocs);

      (mockClient.documents.create as ReturnType<typeof vi.fn>).mockResolvedValue(newDoc);
      (mockClient.versions.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { result } = renderHook(() =>
        useDocuments({
          client: mockClient,
          siteId: 'site1',
          branchId: 'branch1',
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.create('page2');
      });

      expect(mockClient.documents.create).toHaveBeenCalledWith({
        siteId: 'site1',
        branchId: 'branch1',
        path: 'page2',
      });

      expect(result.current.documents).toEqual(updatedDocs);
    });

    // Component #2: the Create Page modal collects a page title. On create it
    // must be persisted into the new page's INITIAL version snapshot at
    // root.props.title (the same field Puck's root "title" input reads/writes),
    // and must compose with template scaffolding (options.templateId) rather
    // than replace it.
    it('seeds root.props.title into the initial version snapshot when a title is provided', async () => {
      (mockClient.documents.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockClient.documents.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'doc2',
        path: '/about',
      });
      (mockClient.versions.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { result } = renderHook(() =>
        useDocuments({ client: mockClient, siteId: 'site1', branchId: 'branch1' })
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.create('/about', undefined, { title: 'My New Page' });
      });

      const snapshot = (mockClient.versions.create as ReturnType<typeof vi.fn>).mock
        .calls[0][1].snapshot;
      expect(snapshot.root.props.title).toBe('My New Page');
    });

    it('does not set a title when none is provided', async () => {
      (mockClient.documents.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockClient.documents.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'doc2',
        path: '/about',
      });
      (mockClient.versions.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { result } = renderHook(() =>
        useDocuments({ client: mockClient, siteId: 'site1', branchId: 'branch1' })
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.create('/about');
      });

      const snapshot = (mockClient.versions.create as ReturnType<typeof vi.fn>).mock
        .calls[0][1].snapshot;
      expect(snapshot.root.props.title).toBeUndefined();
    });

    it('merges the title into provided initialData (template scaffold) without dropping content', async () => {
      const scaffold = {
        content: [{ type: 'Heading', props: { id: 'h1' } }],
        root: { props: { foo: 'bar' } },
      };
      (mockClient.documents.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockClient.documents.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'doc2',
        path: '/about',
      });
      (mockClient.versions.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { result } = renderHook(() =>
        useDocuments({ client: mockClient, siteId: 'site1', branchId: 'branch1' })
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.create('/about', scaffold as never, {
          title: 'Blog Post',
          templateId: 't1',
          templateVersion: 2,
        });
      });

      // Template binding still flows through to documents.create.
      expect(mockClient.documents.create).toHaveBeenCalledWith({
        siteId: 'site1',
        branchId: 'branch1',
        path: '/about',
        templateId: 't1',
        templateVersion: 2,
      });

      const snapshot = (mockClient.versions.create as ReturnType<typeof vi.fn>).mock
        .calls[0][1].snapshot;
      expect(snapshot.content).toEqual(scaffold.content);
      expect(snapshot.root.props).toEqual({ foo: 'bar', title: 'Blog Post' });
    });

    it('should remove a document and refresh the list', async () => {
      const initialDocs = [
        { id: 'doc1', path: 'page1' },
        { id: 'doc2', path: 'page2' },
      ];
      const updatedDocs = [{ id: 'doc1', path: 'page1' }];

      (mockClient.documents.list as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(initialDocs)
        .mockResolvedValueOnce(updatedDocs);

      (mockClient.documents.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useDocuments({
          client: mockClient,
          siteId: 'site1',
          branchId: 'branch1',
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.remove('doc2');
      });

      expect(mockClient.documents.delete).toHaveBeenCalledWith('site1', 'branch1', 'doc2');
      expect(result.current.documents).toEqual(updatedDocs);
    });
  });

  describe('getByPath', () => {
    it('should return a document by path', async () => {
      const docs = [
        { id: 'doc1', path: 'page1' },
        { id: 'doc2', path: 'page2' },
      ];

      (mockClient.documents.list as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const { result } = renderHook(() =>
        useDocuments({
          client: mockClient,
          siteId: 'site1',
          branchId: 'branch1',
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.getByPath('page1')).toEqual({ id: 'doc1', path: 'page1' });
      expect(result.current.getByPath('page2')).toEqual({ id: 'doc2', path: 'page2' });
      expect(result.current.getByPath('nonexistent')).toBeUndefined();
    });
  });
});
