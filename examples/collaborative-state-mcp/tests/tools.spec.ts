/**
 * MCP Tools Tests
 *
 * Tests for the MCP tool definitions that expose
 * Collaborative State System functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiClient } from '../src/api-client.js';
import type { Mock } from 'vitest';

// Create typed mock functions
const listSitesMock: Mock = vi.fn();
const listBranchesMock: Mock = vi.fn();
const listDocumentsMock: Mock = vi.fn();
const getDocumentMock: Mock = vi.fn();
const canAgentEditMock: Mock = vi.fn();
const startAgentEditMock: Mock = vi.fn();
const applyEditsMock: Mock = vi.fn();
const completeAgentEditMock: Mock = vi.fn();
const abortAgentEditMock: Mock = vi.fn();
const getBranchPresenceMock: Mock = vi.fn();
const getDocumentPresenceMock: Mock = vi.fn();
const createBranchMock: Mock = vi.fn();

// Create mock API client with typed mock functions
const mockApiClient = {
  listSites: listSitesMock,
  listBranches: listBranchesMock,
  listDocuments: listDocumentsMock,
  getDocument: getDocumentMock,
  canAgentEdit: canAgentEditMock,
  startAgentEdit: startAgentEditMock,
  applyEdits: applyEditsMock,
  completeAgentEdit: completeAgentEditMock,
  abortAgentEdit: abortAgentEditMock,
  getBranchPresence: getBranchPresenceMock,
  getDocumentPresence: getDocumentPresenceMock,
  createBranch: createBranchMock,
} as unknown as ApiClient;

describe('MCP Tools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Definitions', () => {
    it('should export tool definitions array', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should define list_sites tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'list_sites');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('site');
    });

    it('should define list_branches tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'list_branches');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('branch');
    });

    it('should define list_documents tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'list_documents');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('document');
    });

    it('should define get_document tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'get_document');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('document');
    });

    it('should define check_edit_permission tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'check_edit_permission');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('permission');
    });

    it('should define start_edit_session tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'start_edit_session');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('session');
    });

    it('should define apply_document_edits tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'apply_document_edits');

      expect(tool).toBeDefined();
      expect(tool?.description).toContain('edit');
    });

    it('should define complete_edit_session tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'complete_edit_session');

      expect(tool).toBeDefined();
      expect(tool?.description.toLowerCase()).toContain('complete');
    });

    it('should define abort_edit_session tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'abort_edit_session');

      expect(tool).toBeDefined();
      expect(tool?.description.toLowerCase()).toContain('abort');
    });

    it('should define create_branch tool', async () => {
      const { getToolDefinitions } = await import('../src/tools.js');
      const tools = getToolDefinitions();
      const tool = tools.find((t) => t.name === 'create_branch');

      expect(tool).toBeDefined();
      expect(tool?.description.toLowerCase()).toContain('branch');
    });
  });

  describe('Tool Handlers', () => {
    describe('list_sites', () => {
      it('should list sites using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        listSitesMock.mockResolvedValueOnce({
          sites: [
            { id: 'site-123', pantheonSiteId: 'pantheon-abc', name: 'My Site', createdAt: '2026-01-26T00:00:00Z' },
            { id: 'site-456', pantheonSiteId: 'pantheon-def', name: 'Other Site', createdAt: '2026-01-26T00:00:00Z' },
          ],
          total: 2,
        });

        const result = await handlers.list_sites();

        expect(listSitesMock).toHaveBeenCalled();
        expect(result.content[0]).toHaveProperty('text');
        expect(result.content[0]?.text).toContain('My Site');
        expect(result.content[0]?.text).toContain('site-123');
      });

      it('should handle empty sites list', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        listSitesMock.mockResolvedValueOnce({
          sites: [],
          total: 0,
        });

        const result = await handlers.list_sites();

        expect(result.content[0]?.text).toContain('No sites found');
      });
    });

    describe('list_branches', () => {
      it('should list branches using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        listBranchesMock.mockResolvedValueOnce({
          branches: [
            { id: 'branch-main', siteId: 'site-123', name: 'main', status: 'active', isMain: true, createdAt: '2026-01-26T00:00:00Z' },
            { id: 'branch-staging', siteId: 'site-123', name: 'staging', status: 'active', isMain: false, createdAt: '2026-01-26T00:00:00Z' },
          ],
          total: 2,
        });

        const result = await handlers.list_branches({ site_id: 'site-123' });

        expect(listBranchesMock).toHaveBeenCalledWith('site-123');
        expect(result.content[0]).toHaveProperty('text');
        expect(result.content[0]?.text).toContain('main');
        expect(result.content[0]?.text).toContain('[default]');
      });

      it('should handle empty branches list', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        listBranchesMock.mockResolvedValueOnce({
          branches: [],
          total: 0,
        });

        const result = await handlers.list_branches({ site_id: 'site-123' });

        expect(result.content[0]?.text).toContain('No branches found');
      });
    });

    describe('list_documents', () => {
      it('should list documents using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        listDocumentsMock.mockResolvedValueOnce({
          documents: [
            { id: 'doc-1', path: '/home', createdAt: '2026-01-26T00:00:00Z' },
          ],
        });

        const result = await handlers.list_documents({
          site_id: 'site-123',
          branch_id: 'main',
        });

        expect(listDocumentsMock).toHaveBeenCalledWith('site-123', 'main');
        expect(result.content[0]).toHaveProperty('text');
        expect(result.content[0]?.text).toContain('/home');
      });
    });

    describe('get_document', () => {
      it('should fetch document content using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        getDocumentMock.mockResolvedValueOnce({
          snapshot: { title: 'Home', body: 'Welcome' },
        });

        const result = await handlers.get_document({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
        });

        expect(getDocumentMock).toHaveBeenCalledWith('site-123', 'main', '/home');
        expect(result.content[0]).toHaveProperty('text');
      });

      it('should extract specific region from document', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        getDocumentMock.mockResolvedValueOnce({
          snapshot: {
            content: {
              title: 'Home',
              body: 'This is the body text.',
            },
          },
        });

        const result = await handlers.get_document({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          region: '/content/body',
        });

        expect(result.content[0]?.text).toContain('This is the body text');
      });
    });

    describe('check_edit_permission', () => {
      it('should check edit permission using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        canAgentEditMock.mockResolvedValueOnce({
          canEdit: true,
        });

        const result = await handlers.check_edit_permission({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          intent: 'Fixing typos',
          target_regions: ['/content/body'],
        });

        expect(canAgentEditMock).toHaveBeenCalledWith({
          siteId: 'site-123',
          branchId: 'main',
          documentPath: '/home',
          intent: 'Fixing typos',
          targetRegions: ['/content/body'],
          trigger: 'autonomous', // Changed from human_requested for checkpoint testing
        });
        expect(result.content[0]?.text).toContain('true');
      });
    });

    describe('start_edit_session', () => {
      it('should start edit session using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        startAgentEditMock.mockResolvedValueOnce({
          editSessionId: 'session-123',
          checkpointId: 'checkpoint-before',
          expiresAt: '2026-01-26T12:05:00Z',
          reservedRegions: ['/content/body'],
        });

        const result = await handlers.start_edit_session({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          intent: 'Fixing typos',
          target_regions: ['/content/body'],
        });

        expect(startAgentEditMock).toHaveBeenCalled();
        expect(result.content[0]?.text).toContain('session-123');
      });
    });

    describe('apply_document_edits', () => {
      it('should apply edits using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        applyEditsMock.mockResolvedValueOnce({
          success: true,
          version: 2,
        });

        const result = await handlers.apply_document_edits({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          edit_session_id: 'session-123',
          operations: [
            { type: 'replace', path: 'content.body', content: 'Fixed text.' },
          ],
        });

        expect(applyEditsMock).toHaveBeenCalledWith({
          siteId: 'site-123',
          branchId: 'main',
          documentPath: '/home',
          editSessionId: 'session-123',
          operations: [
            { type: 'replace', path: 'content.body', content: 'Fixed text.' },
          ],
        });
        expect(result.content[0]?.text).toContain('success');
      });

      it('should normalize JSON Pointer paths to dot-notation', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        applyEditsMock.mockResolvedValueOnce({
          success: true,
          version: 2,
        });

        // Input uses JSON Pointer format (/content/0/props/title)
        await handlers.apply_document_edits({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          edit_session_id: 'session-456',
          operations: [
            { type: 'replace', path: '/content/0/props/title', content: 'New Title' },
          ],
        });

        // Output should be normalized to dot-notation (content.0.props.title)
        expect(applyEditsMock).toHaveBeenCalledWith({
          siteId: 'site-123',
          branchId: 'main',
          documentPath: '/home',
          editSessionId: 'session-456',
          operations: [
            { type: 'replace', path: 'content.0.props.title', content: 'New Title' },
          ],
        });
      });
    });

    describe('complete_edit_session', () => {
      it('should complete edit session using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        completeAgentEditMock.mockResolvedValueOnce({
          success: true,
          checkpointId: 'checkpoint-after',
        });

        const result = await handlers.complete_edit_session({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          edit_session_id: 'session-123',
        });

        expect(completeAgentEditMock).toHaveBeenCalledWith({
          siteId: 'site-123',
          branchId: 'main',
          documentPath: '/home',
          editSessionId: 'session-123',
        });
        expect(result.content[0]?.text).toContain('Checkpoint: checkpoint-after');
      });

      it('should not include literal "undefined" in response message when checkpointId is missing', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        // Simulate API returning undefined checkpointId
        completeAgentEditMock.mockResolvedValueOnce({
          success: true,
          checkpointId: undefined,
        });

        const result = await handlers.complete_edit_session({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          edit_session_id: 'session-123',
        });

        // The message should not contain the literal string "undefined"
        const message = result.content[0]?.text ?? '';
        expect(message).not.toContain('undefined');
        expect(message).not.toContain('Checkpoint created: undefined');
      });
    });

    describe('abort_edit_session', () => {
      it('should abort edit session using API client', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        abortAgentEditMock.mockResolvedValueOnce({
          success: true,
          rolledBack: true,
        });

        const result = await handlers.abort_edit_session({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
          edit_session_id: 'session-123',
          reason: 'User cancelled',
        });

        expect(abortAgentEditMock).toHaveBeenCalledWith({
          siteId: 'site-123',
          branchId: 'main',
          documentPath: '/home',
          editSessionId: 'session-123',
          reason: 'User cancelled',
        });
        expect(result.content[0]?.text).toContain('rolled back');
      });
    });

    describe('get_branch_presence', () => {
      it('should return branch presence information', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        getBranchPresenceMock.mockResolvedValueOnce({
          siteId: 'site-123',
          branchId: 'main',
          documents: [
            {
              documentId: 'doc-1',
              documentPath: '/home',
              actors: [
                {
                  id: 'presence-1',
                  actorId: 'user-123',
                  role: 'human',
                  name: 'Test User',
                  state: 'active',
                },
              ],
              actorCount: 1,
              hasActiveEditors: false,
            },
          ],
          totalActors: 1,
          totalDocuments: 1,
        });

        const result = await handlers.get_branch_presence({
          site_id: 'site-123',
          branch_id: 'main',
        });

        expect(getBranchPresenceMock).toHaveBeenCalledWith('site-123', 'main');
        expect(result.content[0]?.text).toContain('/home');
        expect(result.content[0]?.text).toContain('Test User');
      });

      it('should return message when no presence', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        getBranchPresenceMock.mockResolvedValueOnce({
          siteId: 'site-123',
          branchId: 'main',
          documents: [],
          totalActors: 0,
          totalDocuments: 0,
        });

        const result = await handlers.get_branch_presence({
          site_id: 'site-123',
          branch_id: 'main',
        });

        expect(result.content[0]?.text).toContain('No active presence');
      });
    });

    describe('create_branch', () => {
      it('should call apiClient.createBranch with mapped fields and format result', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        createBranchMock.mockResolvedValueOnce({
          id: 'branch-new-1',
          siteId: 'site-123',
          name: 'draft-hero',
          description: 'PCC-1234',
          status: 'active',
          isMain: false,
          sourceBranchId: 'branch-main',
          sourceCheckpointId: 'cp-1',
          createdById: 'a0000000-0000-0000-0000-000000000001',
          createdByType: 'agent',
          createdAt: '2026-05-12T00:00:00Z',
          updatedAt: '2026-05-12T00:00:00Z',
        });

        const result = await handlers.create_branch({
          site_id: 'site-123',
          name: 'draft-hero',
          description: 'PCC-1234',
          parent_branch_id: 'branch-main',
        });

        expect(createBranchMock).toHaveBeenCalledWith('site-123', {
          name: 'draft-hero',
          description: 'PCC-1234',
          parentBranchId: 'branch-main',
        });
        const text = result.content[0]?.text ?? '';
        expect(text).toContain('branch-new-1');
        expect(text).toContain('draft-hero');
        expect(result.isError).toBeFalsy();
      });

      it('should pass only name when description and parent_branch_id are absent', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        createBranchMock.mockResolvedValueOnce({
          id: 'b', siteId: 'site-123', name: 'minimal',
          status: 'active', isMain: false,
          createdById: '', createdByType: 'agent',
          createdAt: '', updatedAt: '',
        });

        await handlers.create_branch({
          site_id: 'site-123',
          name: 'minimal',
        });

        const call = createBranchMock.mock.calls[0] as [string, Record<string, unknown>];
        expect(call[0]).toBe('site-123');
        expect(call[1].name).toBe('minimal');
        expect(call[1]).not.toHaveProperty('description');
        expect(call[1]).not.toHaveProperty('parentBranchId');
      });

      it('should return isError:true when API rejects', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        createBranchMock.mockRejectedValueOnce(new Error('Branch with this name already exists'));

        const result = await handlers.create_branch({
          site_id: 'site-123',
          name: 'main',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('already exists');
      });
    });

    describe('get_document_presence', () => {
      it('should return document presence information', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        getDocumentPresenceMock.mockResolvedValueOnce({
          presences: [
            {
              id: 'presence-1',
              actorId: 'user-123',
              role: 'human',
              name: 'Test User',
              state: 'editing',
              focusRegions: ['/content/0'],
            },
            {
              id: 'presence-2',
              actorId: 'a0000000-0000-0000-0000-000000000001',
              role: 'agent',
              name: 'Zappy',
              state: 'active',
              intent: 'Updating content',
            },
          ],
        });

        const result = await handlers.get_document_presence({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/home',
        });

        expect(getDocumentPresenceMock).toHaveBeenCalledWith('site-123', 'main', '/home');
        expect(result.content[0]?.text).toContain('Test User');
        expect(result.content[0]?.text).toContain('Zappy');
        expect(result.content[0]?.text).toContain('Updating content');
      });

      it('should return message when no one is viewing', async () => {
        const { createToolHandlers } = await import('../src/tools.js');
        const handlers = createToolHandlers(mockApiClient);

        getDocumentPresenceMock.mockResolvedValueOnce({
          presences: [],
        });

        const result = await handlers.get_document_presence({
          site_id: 'site-123',
          branch_id: 'main',
          document_path: '/about',
        });

        expect(result.content[0]?.text).toContain('No one is currently viewing');
      });
    });
  });
});
