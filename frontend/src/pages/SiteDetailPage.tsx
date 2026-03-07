/**
 * Site Detail Page
 *
 * Displays a single site with its branches list.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listBranches, createBranch, updateBranch, deleteBranch as deleteBranchApi } from '../api/branches';
import {
  listCollaborators,
  addCollaborator as addCollaboratorApi,
  removeCollaborator as removeCollaboratorApi,
} from '../api/collaborators';
import type { AddCollaboratorParams } from '../api/collaborators';
import {
  listSiteTokens,
  generateSiteToken as generateSiteTokenApi,
  revokeSiteToken as revokeSiteTokenApi,
} from '../api/site-tokens';
import type { GenerateTokenParams, GenerateTokenResult } from '../api/site-tokens';
import { listUsers } from '../api/users';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { Site, Branch, Collaborator, SystemUser, SiteApiToken } from '../types';
import {
  Button,
  RouterLinkButton,
  Alert,
  Tag,
} from '@pantheon-systems/design-toolkit-react';
import './SiteDetailPage.css';

interface CreateBranchParams {
  name: string;
  parentBranchId?: string;
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
  const [selectedParentBranch, setSelectedParentBranch] = useState<string>('');
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);
  const [archivingBranchId, setArchivingBranchId] = useState<string | null>(null);

  // Collaborator form state
  const [showCollaboratorForm, setShowCollaboratorForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedCollaboratorRole, setSelectedCollaboratorRole] = useState('developer');
  const [collaboratorToRemove, setCollaboratorToRemove] = useState<Collaborator | null>(null);

  // Token state
  const { data: tokens, isLoading: tokensLoading, error: tokensError, execute: fetchTokens } =
    useApi<SiteApiToken[], [string]>(listSiteTokens);
  const { execute: generateTokenRequest, isLoading: isGeneratingToken, error: generateTokenError } =
    useApi<GenerateTokenResult, [string, GenerateTokenParams]>(generateSiteTokenApi);
  const { execute: revokeTokenRequest, isLoading: isRevokingToken, error: revokeTokenError } =
    useApi<void, [string, string]>(revokeSiteTokenApi);

  const [showTokenForm, setShowTokenForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<GenerateTokenResult | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<SiteApiToken | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    if (siteId) {
      fetchSite(siteId);
      fetchBranches(siteId);
      fetchCollaborators(siteId);
      fetchSystemUsers();
      fetchTokens(siteId);
    }
  }, [siteId, fetchSite, fetchBranches, fetchCollaborators, fetchSystemUsers, fetchTokens]);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim() || !siteId) return;

    const params: CreateBranchParams = { name: newBranchName.trim() };
    if (selectedParentBranch) {
      params.parentBranchId = selectedParentBranch;
    }

    const result = await createBranchRequest(siteId, params);
    if (result) {
      setNewBranchName('');
      setSelectedParentBranch('');
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

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim() || !siteId) return;

    const result = await generateTokenRequest(siteId, { name: newTokenName.trim() });
    if (result) {
      setGeneratedToken(result);
      setNewTokenName('');
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
                <select
                  value={selectedParentBranch}
                  onChange={(e) => setSelectedParentBranch(e.target.value)}
                  className="pds-select"
                  aria-label="Parent branch"
                  data-testid="parent-branch-select"
                >
                  <option value="">No parent (main branch)</option>
                  {branches?.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="primary"
                isSubmit
                onClick={() => {}}
                disabled={isCreating || !newBranchName.trim()}
                isLoading={isCreating}
                data-testid="submit-branch-btn"
              >
                {isCreating ? 'Creating...' : 'Create'}
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
                  <th>Parent</th>
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
                    <td className="branch-parent">
                      {branch.sourceBranchId ? (
                        <code>{branch.sourceBranchId.slice(0, 8)}...</code>
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

      {/* API Tokens Section */}
      <section className="tokens-section" data-testid="tokens-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-tokens">API Tokens</h2>
          <Button
            type={showTokenForm ? 'secondary' : 'primary'}
            onClick={() => { setShowTokenForm(!showTokenForm); setGeneratedToken(null); }}
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
                        <Tag key={scope} type="default">{scope}</Tag>
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
    </div>
  );
}
