/**
 * Site Detail Page
 *
 * Displays a single site with its branches list.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite, updateSite } from '../api/sites';
import { listBranches, createBranch, updateBranch, deleteBranch as deleteBranchApi } from '../api/branches';
import {
  listCollaborators,
  addCollaborator as addCollaboratorApi,
  removeCollaborator as removeCollaboratorApi,
} from '../api/collaborators';
import type { AddCollaboratorParams } from '../api/collaborators';
import {
  listSiteAgentRoles,
  grantSiteAgentRole,
  revokeSiteAgentRole,
  listAgents,
} from '../api/agents';
import {
  listSiteTokens,
  generateSiteToken as generateSiteTokenApi,
  revokeSiteToken as revokeSiteTokenApi,
} from '../api/site-tokens';
import type { GenerateTokenParams, GenerateTokenResult } from '../api/site-tokens';
import { getSiteSettings, updateSiteSettings } from '../api/site-settings';
import type { SiteSettings } from '../api/site-settings';
import { listUsers } from '../api/users';
import { ApiResponse } from '../components/ApiResponse';
import { CacheSettings } from '../components/CacheSettings';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ScopeSelector } from '../components/ScopeSelector';
import type { Site, Branch, Collaborator, SystemUser, SiteApiToken, AgentSiteRole, RegisteredAgent } from '../types';
import {
  Button,
  RouterLinkButton,
  Alert,
  Tag,
} from '@pantheon-systems/design-toolkit-react';
import './SiteDetailPage.css';

interface CreateBranchParams {
  name: string;
}

export function SiteDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();

  const { data: site, isLoading: siteLoading, error: siteError, execute: fetchSite } =
    useApi<Site, [string]>(getSite);
  const { data: branches, isLoading: branchesLoading, error: branchesError, execute: fetchBranches } =
    useApi<Branch[], [string]>(listBranches);
  const { execute: createBranchRequest, isLoading: isCreating, error: createError } =
    useApi<Branch, [string, CreateBranchParams]>(createBranch);
  const { execute: deleteBranchRequest, isLoading: isDeleting, error: deleteError } =
    useApi<void, [string, string]>(deleteBranchApi);
  const { execute: archiveBranchRequest, isLoading: isArchiving } =
    useApi<Branch, [string, string, { status: Branch['status'] }]>(updateBranch);

  // Collaborator state
  const { data: collaborators, isLoading: collaboratorsLoading, error: collaboratorsError, execute: fetchCollaborators } =
    useApi<Collaborator[], [string]>(listCollaborators);
  const { data: systemUsers, execute: fetchSystemUsers } =
    useApi<SystemUser[], []>(listUsers);
  const { execute: addCollaboratorRequest, isLoading: isAddingCollaborator, error: addCollaboratorError } =
    useApi<Collaborator, [string, AddCollaboratorParams]>(addCollaboratorApi);
  const { execute: removeCollaboratorRequest, isLoading: isRemovingCollaborator, error: removeCollaboratorError } =
    useApi<void, [string, string]>(removeCollaboratorApi);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);
  const [archivingBranchId, setArchivingBranchId] = useState<string | null>(null);

  // Collaborator form state
  const [showCollaboratorForm, setShowCollaboratorForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedCollaboratorRole, setSelectedCollaboratorRole] = useState('developer');
  const [collaboratorToRemove, setCollaboratorToRemove] = useState<Collaborator | null>(null);

  // Agent access state
  const { data: agentRoles, execute: fetchAgentRoles } =
    useApi<AgentSiteRole[], [string]>(listSiteAgentRoles);
  const { data: allAgents, execute: fetchAllAgents } =
    useApi<RegisteredAgent[], []>(listAgents);
  const { execute: grantRoleRequest, isLoading: isGranting, error: grantError } =
    useApi<AgentSiteRole, [string, { agentId: string; role: string }]>(grantSiteAgentRole);
  const { execute: revokeRoleRequest, isLoading: isRevoking, error: revokeRoleError } =
    useApi<void, [string, string]>(revokeSiteAgentRole);

  const [showGrantForm, setShowGrantForm] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedAgentRole, setSelectedAgentRole] = useState('editor');
  const [roleToRevoke, setRoleToRevoke] = useState<AgentSiteRole | null>(null);

  // Token state
  const { data: tokens, isLoading: tokensLoading, error: tokensError, execute: fetchTokens } =
    useApi<SiteApiToken[], [string]>(listSiteTokens);
  const { execute: generateTokenRequest, isLoading: isGeneratingToken, error: generateTokenError } =
    useApi<GenerateTokenResult, [string, GenerateTokenParams]>(generateSiteTokenApi);
  const { execute: revokeTokenRequest, isLoading: isRevokingToken, error: revokeTokenError } =
    useApi<void, [string, string]>(revokeSiteTokenApi);

  // Settings state
  const { data: siteSettings, isLoading: settingsLoading, execute: fetchSettings } =
    useApi<SiteSettings, [string]>(getSiteSettings);
  const { execute: updateSettingsRequest, isLoading: isUpdatingSettings } =
    useApi<SiteSettings, [string, Partial<SiteSettings>]>(updateSiteSettings);

  const [showTokenForm, setShowTokenForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read:published']);
  const [generatedToken, setGeneratedToken] = useState<GenerateTokenResult | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<SiteApiToken | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Allowed Origins state
  const { execute: updateOriginRequest, isLoading: isUpdatingOrigins, error: updateOriginsError } =
    useApi<Site, [string, { allowedOrigins: string[] }]>(updateSite);
  const [showOriginForm, setShowOriginForm] = useState(false);
  const [newOriginValue, setNewOriginValue] = useState('');
  const [originToRemove, setOriginToRemove] = useState<string | null>(null);

  useEffect(() => {
    if (siteId) {
      fetchSite(siteId);
      fetchBranches(siteId);
      fetchCollaborators(siteId);
      fetchSystemUsers();
      fetchAgentRoles(siteId);
      fetchAllAgents();
      fetchTokens(siteId);
      fetchSettings(siteId);
    }
  }, [siteId, fetchSite, fetchBranches, fetchCollaborators, fetchSystemUsers, fetchAgentRoles, fetchAllAgents, fetchTokens, fetchSettings]);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim() || !siteId) return;

    const result = await createBranchRequest(siteId, { name: newBranchName.trim() });
    if (result) {
      setNewBranchName('');
      setShowCreateForm(false);
      fetchBranches(siteId);
    }
  };

  const handleDeleteBranch = async () => {
    if (!branchToDelete || !siteId) return;

    const result = await deleteBranchRequest(siteId, branchToDelete.id);
    // Only close modal and refresh if deletion succeeded
    // For void functions: undefined = success, null = error
    if (result !== null) {
      setBranchToDelete(null);
      fetchBranches(siteId);
    }
  };

  const handleArchiveBranch = async (branch: Branch) => {
    if (!siteId) return;

    setArchivingBranchId(branch.id);
    const result = await archiveBranchRequest(siteId, branch.id, { status: 'archived' });
    setArchivingBranchId(null);

    if (result) {
      fetchBranches(siteId);
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !siteId) return;

    const result = await addCollaboratorRequest(siteId, {
      userId: selectedUserId,
      role: selectedCollaboratorRole,
    });
    if (result) {
      setSelectedUserId('');
      setSelectedCollaboratorRole('developer');
      setShowCollaboratorForm(false);
      fetchCollaborators(siteId);
    }
  };

  const handleRemoveCollaborator = async () => {
    if (!collaboratorToRemove || !siteId) return;

    const result = await removeCollaboratorRequest(siteId, collaboratorToRemove.userId);
    if (result !== null) {
      setCollaboratorToRemove(null);
      fetchCollaborators(siteId);
    }
  };

  const handleGrantAgentRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !siteId) return;

    const result = await grantRoleRequest(siteId, {
      agentId: selectedAgentId,
      role: selectedAgentRole,
    });
    if (result) {
      setSelectedAgentId('');
      setSelectedAgentRole('editor');
      setShowGrantForm(false);
      fetchAgentRoles(siteId);
    }
  };

  const handleRevokeAgentRole = async () => {
    if (!roleToRevoke || !siteId) return;

    const result = await revokeRoleRequest(siteId, roleToRevoke.id);
    if (result !== null) {
      setRoleToRevoke(null);
      fetchAgentRoles(siteId);
    }
  };

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim() || !siteId) return;

    const result = await generateTokenRequest(siteId, { name: newTokenName.trim(), scopes: selectedScopes });
    if (result) {
      setGeneratedToken(result);
      setNewTokenName('');
      setSelectedScopes(['read:published']);
      setShowTokenForm(false);
      fetchTokens(siteId);
    }
  };

  const handleRevokeToken = async () => {
    if (!tokenToRevoke || !siteId) return;

    const result = await revokeTokenRequest(siteId, tokenToRevoke.id);
    if (result !== null) {
      setTokenToRevoke(null);
      fetchTokens(siteId);
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
    }
  };

  const handleAddOrigin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOriginValue.trim() || !siteId) return;

    const currentOrigins = site?.allowedOrigins ?? [];
    if (currentOrigins.includes(newOriginValue.trim())) return;

    const result = await updateOriginRequest(siteId, {
      allowedOrigins: [...currentOrigins, newOriginValue.trim()],
    });
    if (result) {
      setNewOriginValue('');
      setShowOriginForm(false);
      fetchSite(siteId);
    }
  };

  const handleRemoveOrigin = async () => {
    if (!originToRemove || !siteId) return;

    const currentOrigins = site?.allowedOrigins ?? [];
    const result = await updateOriginRequest(siteId, {
      allowedOrigins: currentOrigins.filter((o) => o !== originToRemove),
    });
    if (result) {
      setOriginToRemove(null);
      fetchSite(siteId);
    }
  };

  const handleSaveSettings = async (settings: { cacheTtlMain?: number | null; cacheTtlBranch?: number | null }) => {
    if (!siteId) return;
    await updateSettingsRequest(siteId, settings as Partial<SiteSettings>);
    fetchSettings(siteId);
  };

  const getUserEmail = (userId: string): string => {
    const user = systemUsers?.find((u) => u.id === userId);
    return user?.email ?? userId;
  };

  const getRoleTagType = (role: string): 'success' | 'info' | 'default' => {
    switch (role) {
      case 'owner':
      case 'admin':
        return 'info';
      case 'developer':
        return 'success';
      default:
        return 'default';
    }
  };

  const getScopeTagType = (scope: string): 'success' | 'info' | 'default' => {
    switch (scope) {
      case 'read:all':
        return 'info';
      case 'read:draft':
        return 'success';
      default:
        return 'default';
    }
  };

  const getSourceTagType = (source: string): 'info' | 'default' => {
    return source === 'mas' ? 'info' : 'default';
  };

  const getStatusTagType = (status: Branch['status']): 'success' | 'info' | 'default' | 'danger' => {
    switch (status) {
      case 'active':
        return 'success';
      case 'merged':
        return 'info';
      case 'archived':
        return 'default';
      case 'abandoned':
        return 'danger';
      default:
        return 'default';
    }
  };

  if (siteLoading) {
    return (
      <div className="site-detail-page">
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      </div>
    );
  }

  if (siteError) {
    return (
      <div className="site-detail-page">
        <div className="error-container">
          <ApiResponse data={null} isLoading={false} error={siteError} />
          <div className="back-link-container">
            <RouterLinkButton to="/sites" type="secondary">
              Back to sites
            </RouterLinkButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="site-detail-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb" data-testid="breadcrumb">
        <Link to="/sites">Sites</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{site?.name || 'Site'}</span>
      </nav>

      {/* Site Info Header */}
      <header className="site-header">
        <div className="site-info">
          <h1 className="site-title" data-testid="site-title">{site?.name}</h1>
          <div className="site-meta">
            <span className="meta-item">
              <strong>ID:</strong> <code>{site?.id}</code>
            </span>
            <span className="meta-item">
              <strong>Pantheon ID:</strong> <code>{site?.pantheonSiteId}</code>
            </span>
            <span className="meta-item">
              <strong>Created:</strong> {site?.createdAt ? new Date(site.createdAt).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>
        <RouterLinkButton
          to={`/sites/${siteId}/merge-requests`}
          type="secondary"
          data-testid="merge-requests-link"
        >
          Merge requests
        </RouterLinkButton>
      </header>

      {/* Branches Section */}
      <section className="branches-section" data-testid="branches-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-branches">Branches</h2>
          <Button
            type={showCreateForm ? 'secondary' : 'primary'}
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-testid="create-branch-btn"
          >
            {showCreateForm ? 'Cancel' : '+ Create branch'}
          </Button>
        </div>

        {showCreateForm && (
          <div className="create-form-container" data-testid="create-branch-form">
            <form onSubmit={handleCreateBranch} className="create-form">
              <div className="form-fields">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Enter branch name..."
                  className="pds-input"
                  autoFocus
                  aria-label="Branch name"
                  data-testid="branch-name-input"
                />
              </div>
              <Button
                type="primary"
                isSubmit
                onClick={() => {}}
                disabled={isCreating || !newBranchName.trim()}
                isLoading={isCreating}
                data-testid="submit-branch-btn"
              >
                {isCreating ? 'Creating...' : 'Create branch from main'}
              </Button>
            </form>
            {createError && (
              <Alert type="danger" className="create-error-alert" data-testid="create-error">
                {createError}
              </Alert>
            )}
          </div>
        )}

        {branchesError && (
          <div className="error-banner">
            <ApiResponse data={null} isLoading={false} error={branchesError} />
          </div>
        )}

        {branchesLoading ? (
          <div className="loading-container">
            <ApiResponse data={null} isLoading={true} error={null} />
          </div>
        ) : branches && branches.length > 0 ? (
          <div className="branches-table-container">
            <table className="branches-table" data-testid="branches-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id} data-testid={`branch-row-${branch.id}`}>
                    <td className="branch-name">{branch.name}</td>
                    <td>
                      <Tag type={getStatusTagType(branch.status)} data-testid={`status-${branch.id}`}>
                        {branch.status}
                      </Tag>
                    </td>
                    <td className="branch-source">
                      {branch.sourceBranchId ? (
                        <span>main</span>
                      ) : (
                        <span className="no-parent">-</span>
                      )}
                    </td>
                    <td className="branch-date">
                      {new Date(branch.createdAt).toLocaleDateString()}
                    </td>
                    <td className="branch-actions">
                      <RouterLinkButton
                        to={`/sites/${siteId}/branches/${branch.id}`}
                        type="secondary"
                        data-testid={`view-branch-${branch.id}`}
                      >
                        View
                      </RouterLinkButton>
                      {!branch.isMain && branch.status !== 'archived' && (
                        <Button
                          type="secondary"
                          onClick={() => handleArchiveBranch(branch)}
                          disabled={isArchiving && archivingBranchId === branch.id}
                          isLoading={isArchiving && archivingBranchId === branch.id}
                          data-testid={`archive-branch-${branch.id}`}
                        >
                          {isArchiving && archivingBranchId === branch.id ? 'Archiving...' : 'Archive'}
                        </Button>
                      )}
                      {!branch.isMain && (
                        <Button
                          type="danger"
                          onClick={() => setBranchToDelete(branch)}
                          data-testid={`delete-branch-${branch.id}`}
                        >
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" data-testid="empty-state">
            <p>No branches found. Create a branch to get started.</p>
          </div>
        )}
      </section>

      {/* Collaborators Section */}
      <section className="collaborators-section" data-testid="collaborators-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-collaborators">Collaborators</h2>
          <Button
            type={showCollaboratorForm ? 'secondary' : 'primary'}
            onClick={() => setShowCollaboratorForm(!showCollaboratorForm)}
            data-testid="add-collaborator-btn"
          >
            {showCollaboratorForm ? 'Cancel' : '+ Add collaborator'}
          </Button>
        </div>

        {showCollaboratorForm && (
          <div className="create-form-container" data-testid="add-collaborator-form">
            <form onSubmit={handleAddCollaborator} className="create-form">
              <div className="form-fields">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="pds-select"
                  aria-label="Select user"
                  data-testid="collaborator-user-select"
                >
                  <option value="">Select a user...</option>
                  {systemUsers?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email}{user.name ? ` (${user.name})` : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedCollaboratorRole}
                  onChange={(e) => setSelectedCollaboratorRole(e.target.value)}
                  className="pds-select"
                  aria-label="Collaborator role"
                  data-testid="collaborator-role-select"
                >
                  <option value="admin">Admin</option>
                  <option value="developer">Developer</option>
                  <option value="team_member">Team Member</option>
                </select>
              </div>
              <Button
                type="primary"
                isSubmit
                onClick={() => {}}
                disabled={isAddingCollaborator || !selectedUserId}
                isLoading={isAddingCollaborator}
                data-testid="submit-collaborator-btn"
              >
                {isAddingCollaborator ? 'Adding...' : 'Add'}
              </Button>
            </form>
            {addCollaboratorError && (
              <Alert type="danger" className="create-error-alert" data-testid="add-collaborator-error">
                {addCollaboratorError}
              </Alert>
            )}
          </div>
        )}

        {collaboratorsError && (
          <div className="error-banner">
            <ApiResponse data={null} isLoading={false} error={collaboratorsError} />
          </div>
        )}

        {collaboratorsLoading ? (
          <div className="loading-container">
            <ApiResponse data={null} isLoading={true} error={null} />
          </div>
        ) : collaborators && collaborators.length > 0 ? (
          <div className="collaborators-table-container">
            <table className="collaborators-table" data-testid="collaborators-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Source</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {collaborators.map((collab) => (
                  <tr key={collab.id} data-testid={`collaborator-row-${collab.id}`}>
                    <td className="collaborator-user">{getUserEmail(collab.userId)}</td>
                    <td>
                      <Tag type={getRoleTagType(collab.role)} data-testid={`collab-role-${collab.id}`}>
                        {collab.role}
                      </Tag>
                    </td>
                    <td>
                      <Tag type={getSourceTagType(collab.source)} data-testid={`collab-source-${collab.id}`}>
                        {collab.source}
                      </Tag>
                    </td>
                    <td className="collaborator-date">
                      {new Date(collab.createdAt).toLocaleDateString()}
                    </td>
                    <td className="collaborator-actions">
                      {collab.source === 'local' && (
                        <Button
                          type="danger"
                          onClick={() => setCollaboratorToRemove(collab)}
                          data-testid={`remove-collaborator-${collab.id}`}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" data-testid="collaborators-empty-state">
            <p>No collaborators found. Add collaborators to grant site access.</p>
          </div>
        )}
      </section>

      {/* Agent Access Section */}
      <section className="agent-access-section" data-testid="agent-access-section">
        <div className="section-header">
          <h2 className="section-title">Agent Access</h2>
          <Button
            type={showGrantForm ? 'secondary' : 'primary'}
            onClick={() => setShowGrantForm(!showGrantForm)}
            data-testid="grant-agent-btn"
          >
            {showGrantForm ? 'Cancel' : '+ Grant access'}
          </Button>
        </div>

        {showGrantForm && (
          <div className="create-form-container" data-testid="grant-agent-form">
            <form onSubmit={handleGrantAgentRole} className="create-form">
              <div className="form-fields">
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="pds-select"
                  aria-label="Select agent"
                  data-testid="agent-select"
                >
                  <option value="">Select an agent...</option>
                  {allAgents
                    ?.filter((agent) => !agentRoles?.some((r) => r.agentId === agent.id))
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
                <select
                  value={selectedAgentRole}
                  onChange={(e) => setSelectedAgentRole(e.target.value)}
                  className="pds-select"
                  aria-label="Agent role"
                  data-testid="agent-role-select"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button
                type="primary"
                isSubmit
                onClick={() => {}}
                disabled={isGranting || !selectedAgentId}
                isLoading={isGranting}
                data-testid="submit-grant-btn"
              >
                {isGranting ? 'Granting...' : 'Grant'}
              </Button>
            </form>
            {grantError && (
              <Alert type="danger" className="create-error-alert" data-testid="grant-error">
                {grantError}
              </Alert>
            )}
          </div>
        )}

        {agentRoles && agentRoles.length > 0 ? (
          <div className="agent-roles-table-container">
            <table className="agent-roles-table" data-testid="agent-roles-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Role</th>
                  <th>Granted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agentRoles.map((role) => (
                  <tr key={role.id} data-testid={`agent-role-row-${role.id}`}>
                    <td className="agent-name">{role.agentName}</td>
                    <td>
                      <Tag type={getRoleTagType(role.role)}>
                        {role.role}
                      </Tag>
                    </td>
                    <td className="agent-role-date">
                      {new Date(role.grantedAt).toLocaleDateString()}
                    </td>
                    <td className="agent-role-actions">
                      <Button
                        type="danger"
                        onClick={() => setRoleToRevoke(role)}
                        data-testid={`revoke-role-${role.id}`}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" data-testid="agent-roles-empty">
            <p>No agents have access to this site. Grant access to allow agents to interact with this site.</p>
          </div>
        )}
      </section>

      {/* API Tokens Section */}
      <section className="tokens-section" data-testid="tokens-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-tokens">API Tokens</h2>
          <Button
            type={showTokenForm ? 'secondary' : 'primary'}
            onClick={() => { setShowTokenForm(!showTokenForm); setGeneratedToken(null); setSelectedScopes(['read:published']); }}
            data-testid="create-token-btn"
          >
            {showTokenForm ? 'Cancel' : '+ Generate token'}
          </Button>
        </div>

        {generatedToken && (
          <div className="raw-token-banner" data-testid="raw-token-display">
            <p><strong>Token generated successfully.</strong> Copy this token now — you won't be able to see it again.</p>
            <div className="raw-token-value">
              <code data-testid="raw-token-value">{generatedToken.token}</code>
              <Button
                type="secondary"
                onClick={() => handleCopyToken(generatedToken.token)}
                data-testid="copy-token-btn"
              >
                {tokenCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <p>Name: <strong>{generatedToken.name}</strong> | Prefix: <code>{generatedToken.prefix}</code></p>
          </div>
        )}

        {showTokenForm && (
          <div className="create-form-container" data-testid="create-token-form">
            <form onSubmit={handleGenerateToken} className="create-form">
              <div className="form-fields">
                <input
                  type="text"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="Enter token name..."
                  className="pds-input"
                  autoFocus
                  aria-label="Token name"
                  data-testid="token-name-input"
                />
              </div>
              <ScopeSelector selectedScopes={selectedScopes} onChange={setSelectedScopes} />
              <Button
                type="primary"
                isSubmit
                onClick={() => {}}
                disabled={isGeneratingToken || !newTokenName.trim()}
                isLoading={isGeneratingToken}
                data-testid="submit-token-btn"
              >
                {isGeneratingToken ? 'Generating...' : 'Generate'}
              </Button>
            </form>
            {generateTokenError && (
              <Alert type="danger" className="create-error-alert" data-testid="generate-token-error">
                {generateTokenError}
              </Alert>
            )}
          </div>
        )}

        {tokensError && (
          <div className="error-banner">
            <ApiResponse data={null} isLoading={false} error={tokensError} />
          </div>
        )}

        {tokensLoading ? (
          <div className="loading-container">
            <ApiResponse data={null} isLoading={true} error={null} />
          </div>
        ) : tokens && tokens.length > 0 ? (
          <div className="tokens-table-container">
            <table className="tokens-table" data-testid="tokens-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} data-testid={`token-row-${token.id}`}>
                    <td className="token-name">{token.name}</td>
                    <td className="token-prefix"><code>{token.prefix}</code></td>
                    <td>
                      {token.scopes.map((scope) => (
                        <Tag key={scope} type={getScopeTagType(scope)} data-testid={`scope-badge-${token.id}-${scope}`}>{scope}</Tag>
                      ))}
                    </td>
                    <td className="token-date">
                      {new Date(token.createdAt).toLocaleDateString()}
                    </td>
                    <td className="token-date">
                      {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="token-actions">
                      <Button
                        type="danger"
                        onClick={() => setTokenToRevoke(token)}
                        data-testid={`revoke-token-${token.id}`}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" data-testid="tokens-empty-state">
            <p>No API tokens found. Generate a token to allow external applications to access this site.</p>
          </div>
        )}
      </section>

      {/* Allowed Origins Section */}
      <section className="allowed-origins-section" data-testid="allowed-origins-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-allowed-origins">Allowed Origins</h2>
          <Button
            type={showOriginForm ? 'secondary' : 'primary'}
            onClick={() => setShowOriginForm(!showOriginForm)}
            data-testid="add-origin-btn"
          >
            {showOriginForm ? 'Cancel' : '+ Add origin'}
          </Button>
        </div>

        {showOriginForm && (
          <div className="create-form-container" data-testid="add-origin-form">
            <form onSubmit={handleAddOrigin} className="create-form">
              <div className="form-fields">
                <input
                  type="text"
                  value={newOriginValue}
                  onChange={(e) => setNewOriginValue(e.target.value)}
                  placeholder="https://example.com or *-mysite.pantheonsite.io"
                  className="pds-input"
                  autoFocus
                  aria-label="Allowed origin"
                  data-testid="origin-input"
                />
              </div>
              <Button
                type="primary"
                isSubmit
                onClick={() => {}}
                disabled={isUpdatingOrigins || !newOriginValue.trim() || (site?.allowedOrigins ?? []).includes(newOriginValue.trim())}
                isLoading={isUpdatingOrigins}
                data-testid="submit-origin-btn"
              >
                {isUpdatingOrigins ? 'Adding...' : 'Add'}
              </Button>
            </form>
            {updateOriginsError && (
              <Alert type="danger" className="create-error-alert" data-testid="add-origin-error">
                {updateOriginsError}
              </Alert>
            )}
          </div>
        )}

        {(site?.allowedOrigins ?? []).length > 0 ? (
          <div className="allowed-origins-table-container">
            <table className="allowed-origins-table" data-testid="allowed-origins-table">
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(site?.allowedOrigins ?? []).map((origin, index) => (
                  <tr key={origin} data-testid={`origin-row-${index}`}>
                    <td className="origin-value"><code>{origin}</code></td>
                    <td className="origin-actions">
                      <Button
                        type="danger"
                        onClick={() => setOriginToRemove(origin)}
                        data-testid={`remove-origin-${index}`}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" data-testid="allowed-origins-empty">
            <p data-testid="allowed-origins-empty-warning">
              No allowed origins configured. OAuth login will be blocked until at least one origin is added.
            </p>
          </div>
        )}
      </section>

      {/* Settings Section */}
      <section className="settings-section" data-testid="settings-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-settings">Settings</h2>
        </div>
        <CacheSettings
          settings={siteSettings}
          isLoading={settingsLoading}
          onSave={handleSaveSettings}
          isSaving={isUpdatingSettings}
        />
      </section>

      <ConfirmDeleteModal
        isOpen={branchToDelete !== null}
        resourceType="branch"
        resourceName={branchToDelete?.name ?? ''}
        onConfirm={handleDeleteBranch}
        onCancel={() => setBranchToDelete(null)}
        isDeleting={isDeleting}
        error={deleteError}
      />

      <ConfirmDeleteModal
        isOpen={collaboratorToRemove !== null}
        resourceType="collaborator"
        resourceName={collaboratorToRemove ? getUserEmail(collaboratorToRemove.userId) : ''}
        onConfirm={handleRemoveCollaborator}
        onCancel={() => setCollaboratorToRemove(null)}
        isDeleting={isRemovingCollaborator}
        error={removeCollaboratorError}
      />

      <ConfirmDeleteModal
        isOpen={tokenToRevoke !== null}
        resourceType="token"
        resourceName={tokenToRevoke?.name ?? ''}
        onConfirm={handleRevokeToken}
        onCancel={() => setTokenToRevoke(null)}
        isDeleting={isRevokingToken}
        error={revokeTokenError}
      />

      <ConfirmDeleteModal
        isOpen={roleToRevoke !== null}
        resourceType="agent role"
        resourceName={roleToRevoke?.agentName ?? ''}
        onConfirm={handleRevokeAgentRole}
        onCancel={() => setRoleToRevoke(null)}
        isDeleting={isRevoking}
        error={revokeRoleError}
      />

      <ConfirmDeleteModal
        isOpen={originToRemove !== null}
        resourceType="origin"
        resourceName={originToRemove ?? ''}
        onConfirm={handleRemoveOrigin}
        onCancel={() => setOriginToRemove(null)}
        isDeleting={isUpdatingOrigins}
        error={updateOriginsError}
      />
    </div>
  );
}
