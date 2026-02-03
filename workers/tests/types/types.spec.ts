/**
 * Phase 1.3: Core TypeScript Types - Test Suite
 *
 * These tests validate that all required types are defined and structurally correct.
 * Tests use compile-time type checking to ensure type definitions match the architecture.
 */

import { describe, it, expect } from 'vitest';

// Import all types - this will fail until types.ts is created
import type {
  // Common enums and utility types
  ActorType,
  PantheonRole,
  AgentSiteRole,
  RoleName,
  BranchStatus,
  CheckpointType,
  DocumentVersionSource,
  MergeRequestStatus,
  ApprovalRequestStatus,
  GuestLinkStatus,
  MergeApprovalMode,
  ApproverMode,
  ConflictResolutionStrategy,
  StructureType,
  NodeType,
  SchemaEnforcementMode,
  EditOperationType,

  // Agent Politeness System types
  CheckpointTrigger,
  CheckpointStatus,
  AgentStatus,
  PresenceState,

  // Core entities
  Site,
  WorkflowSettings,
  Branch,
  Document,
  DocumentVersion,

  // Organization and Agent Registry (Agent Politeness)
  Organization,
  OrganizationSettings,
  RegisteredAgent,
  AgentSettings,

  // Checkpoint
  Checkpoint,

  // Merge
  MergeRequest,
  ConflictDetails,
  DocumentConflict,

  // Authorization
  Role,
  RolePermissions,
  BranchGrant,
  GuestLink,
  ApprovalRequest,

  // Identity
  AuthenticatedPrincipal,
  AgentIdentity,
  MockUser,
  MockAgent,
  MockIdentityConfig,

  // Structure
  SiteStructure,
  StructureNode,
  BranchStructureState,
  BranchDocumentMetadata,
  SchemaValidationResult,
  NonConformingDocument,
  SchemaValidationError,
  StructureMergeConflict,

  // Operations
  EditOperation,
  ConnectionMeta,

  // Audit
  AuditEvent,
  AuditActor,
  AuditResource,

  // Presence and Agent Politeness
  ActorPresence,
  AgentEditContext,
  AgentEditPermission,
} from '../../src/types';

/**
 * Type assertion helper - ensures a value conforms to a type at compile time.
 * If the type doesn't match, TypeScript will error during compilation.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function assertType<T>(_value: T): void {
  // No runtime assertion needed - this is purely for compile-time checking
}

describe('Phase 1.3: Core TypeScript Types', () => {
  describe('Common Enums and Union Types', () => {
    it('should define ActorType union', () => {
      const values: ActorType[] = ['user', 'agent', 'guest', 'service', 'system'];
      expect(values).toHaveLength(5);
    });

    it('should define PantheonRole union', () => {
      const values: PantheonRole[] = ['owner', 'admin', 'developer', 'team_member'];
      expect(values).toHaveLength(4);
    });

    it('should define AgentSiteRole union', () => {
      const values: AgentSiteRole[] = ['viewer', 'editor', 'admin'];
      expect(values).toHaveLength(3);
    });

    it('should define RoleName union', () => {
      const values: RoleName[] = ['NO_ACCESS', 'VIEWER', 'EDITOR', 'ADMIN'];
      expect(values).toHaveLength(4);
    });

    it('should define BranchStatus union', () => {
      const values: BranchStatus[] = ['active', 'review', 'merged', 'archived'];
      expect(values).toHaveLength(4);
    });

    it('should define CheckpointType union', () => {
      const values: CheckpointType[] = ['manual', 'auto', 'pre_merge', 'post_merge'];
      expect(values).toHaveLength(4);
    });

    it('should define DocumentVersionSource union', () => {
      const values: DocumentVersionSource[] = ['edit', 'merge', 'revert', 'checkpoint'];
      expect(values).toHaveLength(4);
    });

    it('should define MergeRequestStatus union', () => {
      const values: MergeRequestStatus[] = ['open', 'approved', 'merged', 'closed', 'conflicted'];
      expect(values).toHaveLength(5);
    });

    it('should define ApprovalRequestStatus union', () => {
      const values: ApprovalRequestStatus[] = ['pending', 'approved', 'rejected', 'expired'];
      expect(values).toHaveLength(4);
    });

    it('should define GuestLinkStatus union', () => {
      const values: GuestLinkStatus[] = ['active', 'revoked', 'expired'];
      expect(values).toHaveLength(3);
    });

    it('should define MergeApprovalMode union', () => {
      const values: MergeApprovalMode[] = ['none', 'optional', 'required'];
      expect(values).toHaveLength(3);
    });

    it('should define ApproverMode union', () => {
      const values: ApproverMode[] = ['role_based', 'explicit', 'both'];
      expect(values).toHaveLength(3);
    });

    it('should define ConflictResolutionStrategy union', () => {
      const values: ConflictResolutionStrategy[] = [
        'take-source',
        'take-target',
        'merge-crdt',
        'manual',
      ];
      expect(values).toHaveLength(4);
    });

    it('should define StructureType union', () => {
      const values: StructureType[] = ['collection', 'hierarchy'];
      expect(values).toHaveLength(2);
    });

    it('should define NodeType union', () => {
      const values: NodeType[] = ['section', 'document', 'external'];
      expect(values).toHaveLength(3);
    });

    it('should define SchemaEnforcementMode union', () => {
      const values: SchemaEnforcementMode[] = ['strict', 'warn', 'none'];
      expect(values).toHaveLength(3);
    });

    it('should define EditOperationType union', () => {
      const values: EditOperationType[] = ['set', 'delete', 'insert', 'move', 'replace'];
      expect(values).toHaveLength(5);
    });
  });

  describe('Core Entities', () => {
    describe('Site', () => {
      it('should have required properties', () => {
        const site: Site = {
          id: 'site-123',
          pantheonSiteId: 'pantheon-456',
          name: 'Test Site',
          workflowSettings: {
            mergeApprovalMode: 'required',
            minApprovers: 1,
            allowSelfApproval: false,
            approverMode: 'role_based',
          },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<Site>(site);
        expect(site.id).toBe('site-123');
      });

      it('should allow optional approverMinRole', () => {
        const settings: WorkflowSettings = {
          mergeApprovalMode: 'required',
          minApprovers: 2,
          allowSelfApproval: false,
          approverMode: 'role_based',
          approverMinRole: 'ADMIN',
        };
        assertType<WorkflowSettings>(settings);
        expect(settings.approverMinRole).toBe('ADMIN');
      });
    });

    describe('Branch', () => {
      it('should have required properties', () => {
        const branch: Branch = {
          id: 'branch-123',
          siteId: 'site-123',
          name: 'feature-branch',
          status: 'active',
          isMain: false,
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<Branch>(branch);
        expect(branch.name).toBe('feature-branch');
      });

      it('should allow optional properties', () => {
        const branch: Branch = {
          id: 'branch-123',
          siteId: 'site-123',
          name: 'feature-branch',
          description: 'A feature branch',
          status: 'active',
          isMain: false,
          sourceBranchId: 'main-branch',
          sourceCheckpointId: 'checkpoint-123',
          createdById: 'user-123',
          createdByType: 'agent',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<Branch>(branch);
        expect(branch.description).toBe('A feature branch');
      });
    });

    describe('Document', () => {
      it('should have required properties', () => {
        const doc: Document = {
          id: 'doc-123',
          siteId: 'site-123',
          path: '/pages/home',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<Document>(doc);
        expect(doc.path).toBe('/pages/home');
      });
    });

    describe('DocumentVersion', () => {
      it('should have required properties', () => {
        const version: DocumentVersion = {
          id: 'version-123',
          documentId: 'doc-123',
          branchId: 'branch-123',
          versionNumber: 1,
          snapshot: { title: 'Home Page' },
          source: 'edit',
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<DocumentVersion>(version);
        expect(version.versionNumber).toBe(1);
      });

      it('should allow optional crdtState as base64 string', () => {
        const version: DocumentVersion = {
          id: 'version-123',
          documentId: 'doc-123',
          branchId: 'branch-123',
          versionNumber: 1,
          snapshot: {},
          crdtState: 'base64encodedstate==',
          source: 'merge',
          createdById: 'system',
          createdByType: 'system',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<DocumentVersion>(version);
        expect(version.crdtState).toBeDefined();
      });
    });
  });

  describe('Checkpoint', () => {
    it('should have required properties', () => {
      const checkpoint: Checkpoint = {
        id: 'checkpoint-123',
        branchId: 'branch-123',
        checkpointType: 'manual',
        createdById: 'user-123',
        createdByType: 'user',
        createdAt: '2024-01-01T00:00:00Z',
      };
      assertType<Checkpoint>(checkpoint);
      expect(checkpoint.checkpointType).toBe('manual');
    });

    it('should allow optional name and message', () => {
      const checkpoint: Checkpoint = {
        id: 'checkpoint-123',
        branchId: 'branch-123',
        name: 'v1.0 Release',
        message: 'Initial release checkpoint',
        checkpointType: 'manual',
        createdById: 'user-123',
        createdByType: 'user',
        createdAt: '2024-01-01T00:00:00Z',
      };
      assertType<Checkpoint>(checkpoint);
      expect(checkpoint.name).toBe('v1.0 Release');
    });
  });

  describe('Merge Types', () => {
    describe('MergeRequest', () => {
      it('should have required properties', () => {
        const mr: MergeRequest = {
          id: 'mr-123',
          siteId: 'site-123',
          sourceBranchId: 'feature-branch',
          targetBranchId: 'main-branch',
          title: 'Add new feature',
          status: 'open',
          hasConflicts: false,
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<MergeRequest>(mr);
        expect(mr.title).toBe('Add new feature');
      });

      it('should allow optional properties including merge metadata', () => {
        const mr: MergeRequest = {
          id: 'mr-123',
          siteId: 'site-123',
          sourceBranchId: 'feature-branch',
          targetBranchId: 'main-branch',
          baseCheckpointId: 'checkpoint-123',
          title: 'Add new feature',
          description: 'This adds a great new feature',
          status: 'merged',
          hasConflicts: false,
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          mergedAt: '2024-01-02T00:00:00Z',
          mergedById: 'user-456',
          mergedByType: 'user',
        };
        assertType<MergeRequest>(mr);
        expect(mr.mergedAt).toBeDefined();
      });

      it('should allow conflict details when hasConflicts is true', () => {
        const mr: MergeRequest = {
          id: 'mr-123',
          siteId: 'site-123',
          sourceBranchId: 'feature-branch',
          targetBranchId: 'main-branch',
          title: 'Conflicting changes',
          status: 'conflicted',
          hasConflicts: true,
          conflictDetails: {
            documentConflicts: [
              {
                documentId: 'doc-123',
                documentPath: '/pages/home',
                conflictType: 'both-modified',
                sourceVersion: 2,
                targetVersion: 3,
              },
            ],
            structureConflicts: [],
          },
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<MergeRequest>(mr);
        expect(mr.conflictDetails?.documentConflicts).toHaveLength(1);
      });
    });

    describe('ConflictDetails', () => {
      it('should contain document and structure conflicts', () => {
        const details: ConflictDetails = {
          documentConflicts: [
            {
              documentId: 'doc-1',
              documentPath: '/path',
              conflictType: 'deleted-in-target',
              sourceVersion: 1,
            },
          ],
          structureConflicts: [
            {
              structureId: 'struct-1',
              conflictType: 'node-move',
              details: {
                nodeId: 'node-1',
                sourceValue: { position: 1 },
                targetValue: { position: 2 },
                baseValue: { position: 0 },
              },
            },
          ],
        };
        assertType<ConflictDetails>(details);
        expect(details.documentConflicts).toHaveLength(1);
        expect(details.structureConflicts).toHaveLength(1);
      });
    });

    describe('DocumentConflict', () => {
      it('should define document conflict structure', () => {
        const conflict: DocumentConflict = {
          documentId: 'doc-123',
          documentPath: '/pages/home',
          conflictType: 'both-modified',
          sourceVersion: 5,
          targetVersion: 6,
        };
        assertType<DocumentConflict>(conflict);
        expect(conflict.conflictType).toBe('both-modified');
      });

      it('should support different conflict types', () => {
        const deletedInSource: DocumentConflict = {
          documentId: 'doc-1',
          documentPath: '/path',
          conflictType: 'deleted-in-source',
          targetVersion: 3,
        };
        const deletedInTarget: DocumentConflict = {
          documentId: 'doc-2',
          documentPath: '/path2',
          conflictType: 'deleted-in-target',
          sourceVersion: 2,
        };
        assertType<DocumentConflict>(deletedInSource);
        assertType<DocumentConflict>(deletedInTarget);
        expect(deletedInSource.conflictType).toBe('deleted-in-source');
        expect(deletedInTarget.conflictType).toBe('deleted-in-target');
      });
    });
  });

  describe('Authorization Types', () => {
    describe('Role and RolePermissions', () => {
      it('should define role permissions structure', () => {
        const permissions: RolePermissions = {
          canView: true,
          canEdit: true,
          canCreateBranch: true,
          canEditDocuments: true,
          canCreateCheckpoint: true,
          canProposeMerge: true,
          canMerge: false,
          canMergeToMain: false,
          canManageGrants: false,
        };
        assertType<RolePermissions>(permissions);
        expect(permissions.canView).toBe(true);
      });

      it('should define Role with name and permissions', () => {
        const role: Role = {
          name: 'EDITOR',
          permissions: {
            canView: true,
            canEdit: true,
            canCreateBranch: true,
            canEditDocuments: true,
            canCreateCheckpoint: true,
            canProposeMerge: true,
            canMerge: false,
            canMergeToMain: false,
            canManageGrants: false,
          },
        };
        assertType<Role>(role);
        expect(role.name).toBe('EDITOR');
      });
    });

    describe('BranchGrant', () => {
      it('should have required properties', () => {
        const grant: BranchGrant = {
          id: 'grant-123',
          branchId: 'branch-123',
          actorId: 'user-123',
          actorType: 'user',
          role: 'EDITOR',
          grantedById: 'admin-123',
          grantedByType: 'user',
          grantedAt: '2024-01-01T00:00:00Z',
        };
        assertType<BranchGrant>(grant);
        expect(grant.role).toBe('EDITOR');
      });

      it('should allow optional reason', () => {
        const grant: BranchGrant = {
          id: 'grant-123',
          branchId: 'branch-123',
          actorId: 'agent-123',
          actorType: 'agent',
          role: 'ADMIN',
          grantedById: 'user-123',
          grantedByType: 'user',
          grantedAt: '2024-01-01T00:00:00Z',
          reason: 'Automated deployment agent',
        };
        assertType<BranchGrant>(grant);
        expect(grant.reason).toBe('Automated deployment agent');
      });
    });

    describe('GuestLink', () => {
      it('should have required properties', () => {
        const link: GuestLink = {
          id: 'link-123',
          branchId: 'branch-123',
          email: 'guest@example.com',
          tokenHash: 'hashed-token',
          status: 'active',
          expiresAt: '2024-02-01T00:00:00Z',
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
          accessCount: 0,
        };
        assertType<GuestLink>(link);
        expect(link.email).toBe('guest@example.com');
      });

      it('should allow optional properties', () => {
        const link: GuestLink = {
          id: 'link-123',
          branchId: 'branch-123',
          email: 'guest@example.com',
          name: 'Guest User',
          tokenHash: 'hashed-token',
          status: 'active',
          expiresAt: '2024-02-01T00:00:00Z',
          createdById: 'user-123',
          createdByType: 'user',
          createdAt: '2024-01-01T00:00:00Z',
          message: 'Please review this branch',
          accessCount: 5,
          lastAccessAt: '2024-01-15T00:00:00Z',
        };
        assertType<GuestLink>(link);
        expect(link.name).toBe('Guest User');
      });
    });

    describe('ApprovalRequest', () => {
      it('should have required properties', () => {
        const request: ApprovalRequest = {
          id: 'approval-123',
          mergeRequestId: 'mr-123',
          approverEmail: 'approver@example.com',
          status: 'pending',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<ApprovalRequest>(request);
        expect(request.status).toBe('pending');
      });

      it('should allow optional properties', () => {
        const request: ApprovalRequest = {
          id: 'approval-123',
          mergeRequestId: 'mr-123',
          approverEmail: 'approver@example.com',
          approverName: 'John Approver',
          tokenHash: 'hashed-token',
          status: 'approved',
          expiresAt: '2024-02-01T00:00:00Z',
          respondedAt: '2024-01-15T00:00:00Z',
          comment: 'Looks good to me!',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<ApprovalRequest>(request);
        expect(request.comment).toBe('Looks good to me!');
      });
    });
  });

  describe('Identity Types', () => {
    describe('AuthenticatedPrincipal', () => {
      it('should have required properties', () => {
        const principal: AuthenticatedPrincipal = {
          id: 'user-123',
          type: 'user',
          tokenExpiry: '2024-01-02T00:00:00Z',
          pantheonSiteRoles: {},
        };
        assertType<AuthenticatedPrincipal>(principal);
        expect(principal.type).toBe('user');
      });

      it('should allow optional properties and site roles', () => {
        const principal: AuthenticatedPrincipal = {
          id: 'user-123',
          type: 'user',
          email: 'user@example.com',
          organizationId: 'org-123',
          pantheonSiteRoles: {
            'site-123': 'admin',
            'site-456': 'developer',
          },
          tokenExpiry: '2024-01-02T00:00:00Z',
          scopes: ['read', 'write'],
        };
        assertType<AuthenticatedPrincipal>(principal);
        expect(principal.pantheonSiteRoles['site-123']).toBe('admin');
      });
    });

    describe('AgentIdentity', () => {
      it('should have required properties', () => {
        const agent: AgentIdentity = {
          id: 'agent-123',
          organizationId: 'org-123',
          name: 'Deployment Bot',
          capabilities: ['deploy', 'publish'],
          siteAccess: {},
        };
        assertType<AgentIdentity>(agent);
        expect(agent.name).toBe('Deployment Bot');
      });

      it('should allow site access mapping', () => {
        const agent: AgentIdentity = {
          id: 'agent-123',
          organizationId: 'org-123',
          name: 'Content Bot',
          capabilities: ['edit-content'],
          siteAccess: {
            'site-123': 'editor',
            'site-456': 'viewer',
          },
        };
        assertType<AgentIdentity>(agent);
        expect(agent.siteAccess['site-123']).toBe('editor');
      });
    });

    describe('MockUser', () => {
      it('should have required properties', () => {
        const user: MockUser = {
          id: 'mock-user-123',
          email: 'test@example.com',
          name: 'Test User',
          siteRoles: {
            'site-123': 'admin',
          },
        };
        assertType<MockUser>(user);
        expect(user.email).toBe('test@example.com');
      });
    });

    describe('MockAgent', () => {
      it('should have required properties', () => {
        const agent: MockAgent = {
          id: 'mock-agent-123',
          name: 'Test Agent',
          apiKey: 'test-api-key-plaintext',
          siteRoles: {
            'site-123': 'editor',
          },
        };
        assertType<MockAgent>(agent);
        expect(agent.apiKey).toBe('test-api-key-plaintext');
      });
    });

    describe('MockIdentityConfig', () => {
      it('should contain users, agents, and default roles', () => {
        const config: MockIdentityConfig = {
          users: [
            {
              id: 'user-1',
              email: 'user1@example.com',
              name: 'User One',
              siteRoles: {},
            },
          ],
          agents: [
            {
              id: 'agent-1',
              name: 'Agent One',
              apiKey: 'key-1',
              siteRoles: {},
            },
          ],
          defaultSiteRoles: {
            'site-123': 'team_member',
          },
        };
        assertType<MockIdentityConfig>(config);
        expect(config.users).toHaveLength(1);
        expect(config.agents).toHaveLength(1);
      });
    });
  });

  describe('Structure Types', () => {
    describe('SiteStructure', () => {
      it('should have required properties', () => {
        const structure: SiteStructure = {
          id: 'struct-123',
          siteId: 'site-123',
          name: 'Main Navigation',
          slug: 'main-nav',
          structureType: 'hierarchy',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<SiteStructure>(structure);
        expect(structure.structureType).toBe('hierarchy');
      });

      it('should allow optional description', () => {
        const structure: SiteStructure = {
          id: 'struct-123',
          siteId: 'site-123',
          name: 'Blog',
          slug: 'blog',
          description: 'Blog post collection',
          structureType: 'collection',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<SiteStructure>(structure);
        expect(structure.description).toBe('Blog post collection');
      });
    });

    describe('StructureNode', () => {
      it('should have required properties for section node', () => {
        const node: StructureNode = {
          id: 'node-123',
          structureId: 'struct-123',
          position: 0,
          name: 'Products',
          slug: 'products',
          nodeType: 'section',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<StructureNode>(node);
        expect(node.nodeType).toBe('section');
      });

      it('should allow optional parent and document reference', () => {
        const node: StructureNode = {
          id: 'node-456',
          structureId: 'struct-123',
          parentNodeId: 'node-123',
          position: 1,
          name: 'Product A',
          slug: 'product-a',
          nodeType: 'document',
          documentId: 'doc-123',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<StructureNode>(node);
        expect(node.documentId).toBe('doc-123');
      });

      it('should allow external URL for external nodes', () => {
        const node: StructureNode = {
          id: 'node-789',
          structureId: 'struct-123',
          position: 2,
          name: 'External Resource',
          slug: 'external',
          nodeType: 'external',
          externalUrl: 'https://example.com',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<StructureNode>(node);
        expect(node.externalUrl).toBe('https://example.com');
      });
    });

    describe('BranchStructureState', () => {
      it('should track structure state per branch', () => {
        const state: BranchStructureState = {
          id: 'state-123',
          branchId: 'branch-123',
          structureId: 'struct-123',
          nodesSnapshot: [
            { id: 'node-1', position: 0 },
            { id: 'node-2', position: 1 },
          ],
          metadataSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
            },
          },
          schemaEnforcement: 'warn',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<BranchStructureState>(state);
        expect(state.schemaEnforcement).toBe('warn');
      });
    });

    describe('BranchDocumentMetadata', () => {
      it('should store metadata per document per branch', () => {
        const metadata: BranchDocumentMetadata = {
          id: 'meta-123',
          branchId: 'branch-123',
          documentId: 'doc-123',
          structureId: 'struct-123',
          metadata: {
            title: 'My Page',
            description: 'Page description',
          },
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<BranchDocumentMetadata>(metadata);
        expect(metadata.metadata.title).toBe('My Page');
      });
    });

    describe('SchemaValidationResult', () => {
      it('should report validation results', () => {
        const result: SchemaValidationResult = {
          structureId: 'struct-123',
          totalDocuments: 10,
          conformingDocuments: 8,
          nonConformingDocuments: [
            {
              documentId: 'doc-1',
              documentPath: '/path/to/doc',
              errors: [
                {
                  field: 'title',
                  message: 'Required field missing',
                },
              ],
            },
          ],
        };
        assertType<SchemaValidationResult>(result);
        expect(result.nonConformingDocuments).toHaveLength(1);
      });

      it('should allow currentValue in errors', () => {
        const error: SchemaValidationError = {
          field: 'status',
          message: 'Invalid enum value',
          currentValue: 'invalid-status',
        };
        assertType<SchemaValidationError>(error);
        expect(error.currentValue).toBe('invalid-status');
      });

      it('should define NonConformingDocument structure', () => {
        const nonConforming: NonConformingDocument = {
          documentId: 'doc-123',
          documentPath: '/pages/broken',
          errors: [
            { field: 'title', message: 'Required field missing' },
            { field: 'status', message: 'Invalid value', currentValue: 'bad' },
          ],
        };
        assertType<NonConformingDocument>(nonConforming);
        expect(nonConforming.errors).toHaveLength(2);
      });
    });

    describe('StructureMergeConflict', () => {
      it('should describe structure-level conflicts', () => {
        const conflict: StructureMergeConflict = {
          structureId: 'struct-123',
          conflictType: 'node-move',
          details: {
            nodeId: 'node-123',
            sourceValue: { position: 1 },
            targetValue: { position: 2 },
            baseValue: { position: 0 },
          },
        };
        assertType<StructureMergeConflict>(conflict);
        expect(conflict.conflictType).toBe('node-move');
      });

      it('should support different conflict types', () => {
        const types: StructureMergeConflict['conflictType'][] = [
          'node-move',
          'node-delete',
          'schema-change',
          'metadata-change',
        ];
        expect(types).toHaveLength(4);
      });
    });
  });

  describe('Operations Types', () => {
    describe('EditOperation', () => {
      it('should define set operation', () => {
        const op: EditOperation = {
          type: 'set',
          path: '/title',
          value: 'New Title',
        };
        assertType<EditOperation>(op);
        expect(op.type).toBe('set');
      });

      it('should define delete operation', () => {
        const op: EditOperation = {
          type: 'delete',
          path: '/obsoleteField',
        };
        assertType<EditOperation>(op);
        expect(op.type).toBe('delete');
      });

      it('should define insert operation with index', () => {
        const op: EditOperation = {
          type: 'insert',
          path: '/items',
          index: 0,
          content: { id: 'new-item' },
        };
        assertType<EditOperation>(op);
        expect(op.index).toBe(0);
      });

      it('should define move operation', () => {
        const op: EditOperation = {
          type: 'move',
          path: '/items',
          fromIndex: 0,
          toIndex: 2,
        };
        assertType<EditOperation>(op);
        expect(op.fromIndex).toBe(0);
      });

      it('should define replace operation', () => {
        const op: EditOperation = {
          type: 'replace',
          path: '/content',
          value: { new: 'content' },
        };
        assertType<EditOperation>(op);
        expect(op.type).toBe('replace');
      });
    });

    describe('ConnectionMeta', () => {
      it('should have required properties', () => {
        const meta: ConnectionMeta = {
          actorId: 'user-123',
          actorType: 'user',
        };
        assertType<ConnectionMeta>(meta);
        expect(meta.actorType).toBe('user');
      });

      it('should support agent connections', () => {
        const meta: ConnectionMeta = {
          actorId: 'agent-123',
          actorType: 'agent',
        };
        assertType<ConnectionMeta>(meta);
        expect(meta.actorType).toBe('agent');
      });
    });
  });

  describe('Audit Types', () => {
    describe('AuditEvent', () => {
      it('should have required properties', () => {
        const event: AuditEvent = {
          service: 'collaborative-state',
          action: 'document.update',
          actor: {
            id: 'user-123',
            type: 'user',
          },
          resource: {
            type: 'document',
            id: 'doc-123',
            siteId: 'site-123',
          },
          context: {
            branchId: 'branch-123',
            versionNumber: 5,
          },
          timestamp: '2024-01-01T00:00:00Z',
          success: true,
        };
        assertType<AuditEvent>(event);
        expect(event.action).toBe('document.update');
      });

      it('should allow optional error message on failure', () => {
        const event: AuditEvent = {
          service: 'collaborative-state',
          action: 'branch.delete',
          actor: {
            id: 'user-123',
            type: 'user',
          },
          resource: {
            type: 'branch',
            id: 'branch-123',
            siteId: 'site-123',
          },
          context: {},
          timestamp: '2024-01-01T00:00:00Z',
          success: false,
          errorMessage: 'Cannot delete main branch',
        };
        assertType<AuditEvent>(event);
        expect(event.errorMessage).toBe('Cannot delete main branch');
      });

      it('should support different actor types', () => {
        const actorTypes: AuditActor['type'][] = ['user', 'agent', 'guest', 'system'];
        expect(actorTypes).toHaveLength(4);
      });

      it('should define AuditResource structure', () => {
        const resource: AuditResource = {
          type: 'document',
          id: 'doc-123',
          siteId: 'site-456',
        };
        assertType<AuditResource>(resource);
        expect(resource.type).toBe('document');
        expect(resource.siteId).toBe('site-456');
      });
    });
  });

  describe('Type Compatibility with Database Schema', () => {
    // These tests ensure types align with database column definitions
    // from the migration files

    it('should use string IDs compatible with UUID columns', () => {
      const site: Site = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        pantheonSiteId: 'pantheon-site-id',
        name: 'Test',
        workflowSettings: {
          mergeApprovalMode: 'none',
          minApprovers: 0,
          allowSelfApproval: true,
          approverMode: 'role_based',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      expect(typeof site.id).toBe('string');
    });

    it('should use ISO string timestamps compatible with TIMESTAMPTZ columns', () => {
      const branch: Branch = {
        id: 'branch-id',
        siteId: 'site-id',
        name: 'main',
        status: 'active',
        isMain: true,
        createdById: 'user-id',
        createdByType: 'user',
        createdAt: '2024-01-01T12:00:00.000Z',
        updatedAt: '2024-01-01T12:00:00.000Z',
      };
      // Verify ISO 8601 format
      expect(branch.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should use Record<string, unknown> for JSONB columns', () => {
      const version: DocumentVersion = {
        id: 'version-id',
        documentId: 'doc-id',
        branchId: 'branch-id',
        versionNumber: 1,
        snapshot: { deeply: { nested: { value: 123 } } },
        source: 'edit',
        createdById: 'user-id',
        createdByType: 'user',
        createdAt: '2024-01-01T00:00:00Z',
      };
      expect(typeof version.snapshot).toBe('object');
    });
  });

  // ===========================================================================
  // Agent Politeness System Types
  // ===========================================================================

  describe('Agent Politeness System Types', () => {
    describe('New Union Types', () => {
      it('should define CheckpointTrigger union', () => {
        const values: CheckpointTrigger[] = ['manual', 'human_requested', 'autonomous'];
        expect(values).toHaveLength(3);
      });

      it('should define CheckpointStatus union', () => {
        const values: CheckpointStatus[] = ['completed', 'rolled_back', 'partial'];
        expect(values).toHaveLength(3);
      });

      it('should define AgentStatus union', () => {
        const values: AgentStatus[] = ['active', 'suspended', 'disabled'];
        expect(values).toHaveLength(3);
      });

      it('should define PresenceState union', () => {
        const values: PresenceState[] = ['active', 'idle', 'editing'];
        expect(values).toHaveLength(3);
      });
    });

    describe('Organization', () => {
      it('should have required properties', () => {
        const org: Organization = {
          id: 'org-123',
          name: 'Acme Corp',
          settings: {
            agentIdleTimeoutMs: 5000,
          },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<Organization>(org);
        expect(org.name).toBe('Acme Corp');
      });

      it('should allow optional settings fields', () => {
        const settings: OrganizationSettings = {
          agentIdleTimeoutMs: 10000,
          agentPriorityTiers: {
            default: {
              name: 'Default',
              idleTimeoutMultiplier: 1.0,
              canInterruptAutonomous: false,
            },
          },
        };
        assertType<OrganizationSettings>(settings);
        const defaultTier = settings.agentPriorityTiers?.default;
        expect(defaultTier?.idleTimeoutMultiplier).toBe(1.0);
      });
    });

    describe('RegisteredAgent', () => {
      it('should have required properties', () => {
        const agent: RegisteredAgent = {
          id: 'agent-123',
          organizationId: 'org-123',
          name: 'Content Bot',
          capabilities: ['edit', 'create'],
          status: 'active',
          settings: {},
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<RegisteredAgent>(agent);
        expect(agent.status).toBe('active');
      });

      it('should allow optional description', () => {
        const agent: RegisteredAgent = {
          id: 'agent-123',
          organizationId: 'org-123',
          name: 'Content Bot',
          description: 'Handles content updates',
          capabilities: ['edit', 'create'],
          status: 'suspended',
          settings: {},
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<RegisteredAgent>(agent);
        expect(agent.description).toBe('Handles content updates');
      });

      it('should support agent settings', () => {
        const settings: AgentSettings = {
          priorityTier: 'premium',
          allowedOperationTypes: ['content_edit', 'style_update'],
          maxConcurrentDocuments: 5,
        };
        assertType<AgentSettings>(settings);
        expect(settings.maxConcurrentDocuments).toBe(5);
      });
    });

    describe('Enhanced Checkpoint', () => {
      it('should support trigger field', () => {
        const checkpoint: Checkpoint = {
          id: 'checkpoint-123',
          branchId: 'branch-123',
          checkpointType: 'auto',
          trigger: 'autonomous',
          createdById: 'agent-123',
          createdByType: 'agent',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<Checkpoint>(checkpoint);
        expect(checkpoint.trigger).toBe('autonomous');
      });

      it('should support human-requested agent work metadata', () => {
        const checkpoint: Checkpoint = {
          id: 'checkpoint-123',
          branchId: 'branch-123',
          checkpointType: 'auto',
          trigger: 'human_requested',
          requestedById: 'user-456',
          operationType: 'content_edit',
          affectedRegions: ['/content/0', '/content/0/props/title'],
          createdById: 'agent-123',
          createdByType: 'agent',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<Checkpoint>(checkpoint);
        expect(checkpoint.requestedById).toBe('user-456');
        expect(checkpoint.affectedRegions).toHaveLength(2);
      });

      it('should support status and rollback tracking', () => {
        const checkpoint: Checkpoint = {
          id: 'checkpoint-123',
          branchId: 'branch-123',
          checkpointType: 'auto',
          trigger: 'autonomous',
          status: 'rolled_back',
          rolledBackById: 'user-789',
          rolledBackAt: '2024-01-02T00:00:00Z',
          createdById: 'agent-123',
          createdByType: 'agent',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<Checkpoint>(checkpoint);
        expect(checkpoint.status).toBe('rolled_back');
        expect(checkpoint.rolledBackById).toBe('user-789');
      });

      it('should support description for detailed metadata', () => {
        const checkpoint: Checkpoint = {
          id: 'checkpoint-123',
          branchId: 'branch-123',
          description: 'Agent updated homepage hero section with new promotional content',
          checkpointType: 'auto',
          trigger: 'autonomous',
          createdById: 'agent-123',
          createdByType: 'agent',
          createdAt: '2024-01-01T00:00:00Z',
        };
        assertType<Checkpoint>(checkpoint);
        expect(checkpoint.description).toContain('homepage hero');
      });
    });

    describe('Site with Organization', () => {
      it('should allow optional organizationId', () => {
        const site: Site = {
          id: 'site-123',
          pantheonSiteId: 'pantheon-456',
          organizationId: 'org-123',
          name: 'Test Site',
          workflowSettings: {
            mergeApprovalMode: 'required',
            minApprovers: 1,
            allowSelfApproval: false,
            approverMode: 'role_based',
          },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        };
        assertType<Site>(site);
        expect(site.organizationId).toBe('org-123');
      });
    });

    describe('ActorPresence', () => {
      it('should have required properties', () => {
        const presence: ActorPresence = {
          id: 'presence-123',
          actorId: 'user-123',
          actorType: 'user',
          role: 'human',
          name: 'Alice',
          state: 'editing',
          lastActivityAt: '2024-01-01T12:00:00Z',
          joinedAt: '2024-01-01T10:00:00Z',
        };
        assertType<ActorPresence>(presence);
        expect(presence.state).toBe('editing');
      });

      it('should allow optional fields for agent context', () => {
        const presence: ActorPresence = {
          id: 'presence-456',
          actorId: 'agent-123',
          actorType: 'agent',
          role: 'agent',
          name: 'Content Bot',
          avatar: 'https://example.com/bot-avatar.png',
          state: 'active',
          intent: 'Updating hero section content',
          focusRegions: ['/content/0', '/content/0/props'],
          lastActivityAt: '2024-01-01T12:00:00Z',
          joinedAt: '2024-01-01T10:00:00Z',
        };
        assertType<ActorPresence>(presence);
        expect(presence.intent).toBe('Updating hero section content');
        expect(presence.focusRegions).toHaveLength(2);
      });
    });

    describe('AgentEditContext', () => {
      it('should have required properties for edit check', () => {
        const context: AgentEditContext = {
          agentId: 'agent-123',
          trigger: 'autonomous',
          targetRegions: ['/content/0'],
        };
        assertType<AgentEditContext>(context);
        expect(context.trigger).toBe('autonomous');
      });

      it('should allow human-requested context', () => {
        const context: AgentEditContext = {
          agentId: 'agent-123',
          trigger: 'human_requested',
          requestedById: 'user-456',
          targetRegions: ['/content/0', '/content/1'],
          intent: 'Fix typo in hero section',
          operationType: 'content_edit',
        };
        assertType<AgentEditContext>(context);
        expect(context.requestedById).toBe('user-456');
      });
    });

    describe('AgentEditPermission', () => {
      it('should allow edit when conditions are met', () => {
        const permission: AgentEditPermission = {
          allowed: true,
        };
        assertType<AgentEditPermission>(permission);
        expect(permission.allowed).toBe(true);
      });

      it('should deny edit with reason when human active', () => {
        const permission: AgentEditPermission = {
          allowed: false,
          reason: 'human_active',
          retryAfterMs: 3000,
        };
        assertType<AgentEditPermission>(permission);
        expect(permission.reason).toBe('human_active');
        expect(permission.retryAfterMs).toBe(3000);
      });

      it('should deny edit with conflicting regions', () => {
        const permission: AgentEditPermission = {
          allowed: false,
          reason: 'region_conflict',
          conflictingRegions: ['/content/0', '/content/0/props'],
        };
        assertType<AgentEditPermission>(permission);
        expect(permission.conflictingRegions).toHaveLength(2);
      });
    });
  });
});
