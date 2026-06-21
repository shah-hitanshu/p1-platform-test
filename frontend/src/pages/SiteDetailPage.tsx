/**
 * Site Detail Page
 *
 * Displays a single site with its branches list.
 */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite, updateSite, deleteSite as deleteSiteApi } from '../api/sites';
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
import { SiteScreenshot } from '../components/SiteScreenshot';
import { GlobeIcon } from '../components/icons/GlobeIcon';
import type { Site, Branch, Collaborator, SystemUser, SiteApiToken, AgentSiteRole, RegisteredAgent } from '../types';
import { isValidUrl } from '../utils/url';
import {
  Breadcrumb,
  Button,
  ButtonLink,
  CompactEmptyState,
  InlineMessage,
  Panel,
  Select,
  StatusBadge,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
import './SiteDetailPage.css';

interface CreateBranchParams {
  name: string;
}

export function SiteDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();

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

  // URL editing state
  const { execute: updateUrlRequest, isLoading: isUpdatingUrl, error: updateUrlError } =
    useApi<Site, [string, { url: string | null }]>(updateSite);
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [newUrlValue, setNewUrlValue] = useState('');
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);

  // Site delete state
  const { execute: deleteSiteRequest, isLoading: isDeletingSite, error: deleteSiteError } =
    useApi<void, [string]>(deleteSiteApi);
  const [confirmDeleteSite, setConfirmDeleteSite] = useState(false);

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

  const openUrlForm = () => {
    setNewUrlValue(site?.url ?? '');
    setUrlValidationError(null);
    setShowUrlForm(true);
  };

  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId) return;

    const trimmed = newUrlValue.trim();
    if (!isValidUrl(trimmed)) {
      setUrlValidationError('Enter a valid URL (e.g. https://example.com).');
      return;
    }
    setUrlValidationError(null);

    const result = await updateUrlRequest(siteId, { url: trimmed === '' ? null : trimmed });
    if (result) {
      setShowUrlForm(false);
      fetchSite(siteId);
    }
  };

  const handleDeleteSite = async () => {
    if (!siteId) return;
    const result = await deleteSiteRequest(siteId);
    if (result !== null) {
      setConfirmDeleteSite(false);
      navigate('/sites');
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

  const getStatusTagColor = (_status: string): 'neutral' => {
    return 'neutral';
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
            <ButtonLink variant="secondary" linkContent={<Link to="/sites">Back to sites</Link>} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="site-detail-page">
      {/* Breadcrumb */}
      <Breadcrumb
        data-testid="breadcrumb"
        crumbs={[
          <Link to="/sites">Sites</Link>,
          <span>{site?.name || 'Site'}</span>,
        ]}
      />

      {/* Site Info Header */}
      <Panel>
        <div className="site-header">
          {site?.id && (
            <div className="site-header__hero" data-testid="site-screenshot-hero">
              <SiteScreenshot siteId={site.id} size="hero" alt={`${site.name ?? ''} screenshot`} />
            </div>
          )}
          <div className="site-header__info">
            <h1 className="site-title" data-testid="site-title">{site?.name}</h1>
            <div className="site-meta-grid">
              <div className="site-meta-cell">
                <span className="site-meta-cell__label">Last changed</span>
                <span className="site-meta-cell__value">
                  {site?.updatedAt
                    ? new Date(site.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : '-'}
                </span>
              </div>
              <div className="site-meta-cell">
                <span className="site-meta-cell__label">Pantheon ID</span>
                <span className="site-meta-cell__value"><code>{site?.pantheonSiteId}</code></span>
              </div>
              <div className="site-meta-cell">
                <span className="site-meta-cell__label">Site ID</span>
                <span className="site-meta-cell__value"><code>{site?.id}</code></span>
              </div>
            </div>
            <div className="site-url-row" data-testid="site-url-row">
              <GlobeIcon className="site-url-row__icon" />
              <span className="site-url-row__label">Site URL:</span>
              {showUrlForm ? (
                <form onSubmit={handleSaveUrl} className="site-url-row__form">
                  <input
                    type="text"
                    className="site-url-row__input"
                    value={newUrlValue}
                    onChange={(e) => {
                      setNewUrlValue(e.target.value);
                      if (urlValidationError !== null) setUrlValidationError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowUrlForm(false);
                        setUrlValidationError(null);
                      }
                    }}
                    placeholder="https://example.com"
                    autoFocus
                    aria-label="Site URL"
                    data-testid="site-url-input"
                  />
                  <Button
                    variant="primary"
                    buttonType="submit"
                    onClick={() => {}}
                    isLoading={isUpdatingUrl}
                    disabled={isUpdatingUrl}
                    label={isUpdatingUrl ? 'Saving...' : 'Save'}
                    data-testid="save-site-url-btn"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowUrlForm(false);
                      setUrlValidationError(null);
                    }}
                    label="Cancel"
                    data-testid="cancel-site-url-btn"
                  />
                </form>
              ) : site?.url ? (
                <>
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site-url-row__link"
                    data-testid="site-url-value"
                  >
                    {site.url}
                    <ExternalLinkIcon className="site-url-row__external" />
                  </a>
                  <button
                    type="button"
                    className="site-url-row__edit"
                    onClick={openUrlForm}
                    aria-label="Edit site URL"
                    data-testid="edit-site-url-btn"
                  >
                    <PencilIcon />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="site-url-row__add"
                  onClick={openUrlForm}
                  data-testid="edit-site-url-btn"
                >
                  + Add URL
                </button>
              )}
            </div>
            {urlValidationError && (
              <InlineMessage type="critical" title={urlValidationError} data-testid="site-url-validation-error" />
            )}
            {updateUrlError && (
              <InlineMessage type="critical" title={updateUrlError} data-testid="site-url-error" />
            )}
          </div>
          <div className="site-header__actions">
            <ButtonLink
              variant="secondary"
              data-testid="merge-requests-link"
              linkContent={<Link to={`/sites/${siteId}/merge-requests`}>Merge requests</Link>}
            />
            <Button
              variant="critical"
              onClick={() => setConfirmDeleteSite(true)}
              label="Delete site"
              data-testid="delete-site-btn"
            />
          </div>
        </div>
      </Panel>

      {/* Branches Section */}
      <Panel data-testid="branches-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-branches">Branches</h2>
          <Button
            variant={showCreateForm ? 'secondary' : 'primary'}
            onClick={() => setShowCreateForm(!showCreateForm)}
            data-testid="create-branch-btn"
            label={showCreateForm ? 'Cancel' : '+ Create branch'}
          />
        </div>

        {showCreateForm && (
          <div className="create-form-container" data-testid="create-branch-form">
            <form onSubmit={handleCreateBranch} className="create-form">
              <div className="form-fields">
                <TextInput
                  id="branch-name-input"
                  label="Branch name"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Enter branch name..."
                  inputProps={{ autoFocus: true }}
                  data-testid="branch-name-input"
                />
              </div>
              <Button
                variant="primary"
                buttonType="submit"
                onClick={() => {}}
                disabled={isCreating || !newBranchName.trim()}
                isLoading={isCreating}
                data-testid="submit-branch-btn"
                label={isCreating ? 'Creating...' : 'Create branch from main'}
              />
            </form>
            {createError && (
              <InlineMessage type="critical" className="create-error-alert" data-testid="create-error" title={createError} />
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
            <table data-testid="branches-table">
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
                      <StatusBadge label={branch.status} color={getStatusTagColor(branch.status)} data-testid={`status-${branch.id}`} />
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
                      <ButtonLink
                        variant="secondary"
                        data-testid={`view-branch-${branch.id}`}
                        linkContent={<Link to={`/sites/${siteId}/branches/${branch.id}`}>View</Link>}
                      />
                      {!branch.isMain && branch.status !== 'archived' && (
                        <Button
                          variant="secondary"
                          onClick={() => handleArchiveBranch(branch)}
                          disabled={isArchiving && archivingBranchId === branch.id}
                          isLoading={isArchiving && archivingBranchId === branch.id}
                          data-testid={`archive-branch-${branch.id}`}
                          label={isArchiving && archivingBranchId === branch.id ? 'Archiving...' : 'Archive'}
                        />
                      )}
                      {!branch.isMain && (
                        <Button
                          variant="critical"
                          onClick={() => setBranchToDelete(branch)}
                          data-testid={`delete-branch-${branch.id}`}
                          label="Delete"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        ) : (
          <CompactEmptyState
            data-testid="empty-state"
            iconName="emptySet"
            heading="No branches found"
            message="Create a branch to get started."
          />
        )}
      </Panel>

      {/* Collaborators Section */}
      <Panel data-testid="collaborators-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-collaborators">Collaborators</h2>
          <Button
            variant={showCollaboratorForm ? 'secondary' : 'primary'}
            onClick={() => setShowCollaboratorForm(!showCollaboratorForm)}
            data-testid="add-collaborator-btn"
            label={showCollaboratorForm ? 'Cancel' : '+ Add collaborator'}
          />
        </div>

        {showCollaboratorForm && (
          <div className="create-form-container" data-testid="add-collaborator-form">
            <form onSubmit={handleAddCollaborator} className="create-form">
              <div className="form-fields">
                <Select
                  id="collaborator-user-select"
                  label="Select user"
                  value={selectedUserId}
                  options={(systemUsers ?? []).map((user) => ({
                    label: user.email + (user.name ? ` (${user.name})` : ''),
                    value: user.id,
                  }))}
                  onOptionSelect={(option) => setSelectedUserId(option.value)}
                  data-testid="collaborator-user-select"
                />
                <Select
                  id="collaborator-role-select"
                  label="Collaborator role"
                  value={selectedCollaboratorRole}
                  options={[
                    { label: 'Admin', value: 'admin' },
                    { label: 'Developer', value: 'developer' },
                    { label: 'Team Member', value: 'team_member' },
                  ]}
                  onOptionSelect={(option) => setSelectedCollaboratorRole(option.value)}
                  data-testid="collaborator-role-select"
                />
              </div>
              <Button
                variant="primary"
                buttonType="submit"
                onClick={() => {}}
                disabled={isAddingCollaborator || !selectedUserId}
                isLoading={isAddingCollaborator}
                data-testid="submit-collaborator-btn"
                label={isAddingCollaborator ? 'Adding...' : 'Add'}
              />
            </form>
            {addCollaboratorError && (
              <InlineMessage type="critical" className="create-error-alert" data-testid="add-collaborator-error" title={addCollaboratorError} />
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
            <table data-testid="collaborators-table">
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
                      <StatusBadge label={collab.role} color="neutral" data-testid={`collab-role-${collab.id}`} />
                    </td>
                    <td>
                      <StatusBadge label={collab.source} color="neutral" data-testid={`collab-source-${collab.id}`} />
                    </td>
                    <td className="collaborator-date">
                      {new Date(collab.createdAt).toLocaleDateString()}
                    </td>
                    <td className="collaborator-actions">
                      {collab.source === 'local' && (
                        <Button
                          variant="critical"
                          onClick={() => setCollaboratorToRemove(collab)}
                          data-testid={`remove-collaborator-${collab.id}`}
                          label="Remove"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        ) : (
          <CompactEmptyState
            data-testid="collaborators-empty-state"
            iconName="emptySet"
            heading="No collaborators found"
            message="Add collaborators to grant site access."
          />
        )}
      </Panel>

      {/* Agent Access Section */}
      <Panel data-testid="agent-access-section">
        <div className="section-header">
          <h2 className="section-title">Agent Access</h2>
          <Button
            variant={showGrantForm ? 'secondary' : 'primary'}
            onClick={() => setShowGrantForm(!showGrantForm)}
            data-testid="grant-agent-btn"
            label={showGrantForm ? 'Cancel' : '+ Grant access'}
          />
        </div>

        {showGrantForm && (
          <div className="create-form-container" data-testid="grant-agent-form">
            <form onSubmit={handleGrantAgentRole} className="create-form">
              <div className="form-fields">
                <Select
                  id="agent-select"
                  label="Select agent"
                  value={selectedAgentId}
                  options={(allAgents ?? [])
                    .filter((agent) => !agentRoles?.some((r) => r.agentId === agent.id))
                    .map((agent) => ({ label: agent.name, value: agent.id }))}
                  onOptionSelect={(option) => setSelectedAgentId(option.value)}
                  data-testid="agent-select"
                />
                <Select
                  id="agent-role-select"
                  label="Agent role"
                  value={selectedAgentRole}
                  options={[
                    { label: 'Viewer', value: 'viewer' },
                    { label: 'Editor', value: 'editor' },
                    { label: 'Admin', value: 'admin' },
                  ]}
                  onOptionSelect={(option) => setSelectedAgentRole(option.value)}
                  data-testid="agent-role-select"
                />
              </div>
              <Button
                variant="primary"
                buttonType="submit"
                onClick={() => {}}
                disabled={isGranting || !selectedAgentId}
                isLoading={isGranting}
                data-testid="submit-grant-btn"
                label={isGranting ? 'Granting...' : 'Grant'}
              />
            </form>
            {grantError && (
              <InlineMessage type="critical" className="create-error-alert" data-testid="grant-error" title={grantError} />
            )}
          </div>
        )}

        {agentRoles && agentRoles.length > 0 ? (
            <table data-testid="agent-roles-table">
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
                      <StatusBadge label={role.role} color="neutral" />
                    </td>
                    <td className="agent-role-date">
                      {new Date(role.grantedAt).toLocaleDateString()}
                    </td>
                    <td className="agent-role-actions">
                      <Button
                        variant="critical"
                        onClick={() => setRoleToRevoke(role)}
                        data-testid={`revoke-role-${role.id}`}
                        label="Revoke"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        ) : (
          <CompactEmptyState
            data-testid="agent-roles-empty"
            iconName="emptySet"
            heading="No agents have access"
            message="Grant access to allow agents to interact with this site."
          />
        )}
      </Panel>

      {/* API Tokens Section */}
      <Panel data-testid="tokens-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-tokens">API Tokens</h2>
          <Button
            variant={showTokenForm ? 'secondary' : 'primary'}
            onClick={() => { setShowTokenForm(!showTokenForm); setGeneratedToken(null); setSelectedScopes(['read:published']); }}
            data-testid="create-token-btn"
            label={showTokenForm ? 'Cancel' : '+ Generate token'}
          />
        </div>

        {generatedToken && (
          <div className="raw-token-banner" data-testid="raw-token-display">
            <p><strong>Token generated successfully.</strong> Copy this token now — you won't be able to see it again.</p>
            <div className="raw-token-value">
              <code data-testid="raw-token-value">{generatedToken.token}</code>
              <Button
                variant="secondary"
                onClick={() => handleCopyToken(generatedToken.token)}
                data-testid="copy-token-btn"
                label={tokenCopied ? 'Copied!' : 'Copy'}
              />
            </div>
            <p>Name: <strong>{generatedToken.name}</strong> | Prefix: <code>{generatedToken.prefix}</code></p>
          </div>
        )}

        {showTokenForm && (
          <div className="create-form-container" data-testid="create-token-form">
            <form onSubmit={handleGenerateToken} className="create-form">
              <div className="form-fields">
                <TextInput
                  id="token-name-input"
                  label="Token name"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="Enter token name..."
                  inputProps={{ autoFocus: true }}
                  data-testid="token-name-input"
                />
              </div>
              <ScopeSelector selectedScopes={selectedScopes} onChange={setSelectedScopes} />
              <Button
                variant="primary"
                buttonType="submit"
                onClick={() => {}}
                disabled={isGeneratingToken || !newTokenName.trim()}
                isLoading={isGeneratingToken}
                data-testid="submit-token-btn"
                label={isGeneratingToken ? 'Generating...' : 'Generate'}
              />
            </form>
            {generateTokenError && (
              <InlineMessage type="critical" className="create-error-alert" data-testid="generate-token-error" title={generateTokenError} />
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
            <table data-testid="tokens-table">
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
                        <StatusBadge key={scope} label={scope} color="neutral" data-testid={`scope-badge-${token.id}-${scope}`} />
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
                        variant="critical"
                        onClick={() => setTokenToRevoke(token)}
                        data-testid={`revoke-token-${token.id}`}
                        label="Revoke"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        ) : (
          <CompactEmptyState
            data-testid="tokens-empty-state"
            iconName="emptySet"
            heading="No API tokens found"
            message="Generate a token to allow external applications to access this site."
          />
        )}
      </Panel>

      {/* Allowed Origins Section */}
      <Panel data-testid="allowed-origins-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-allowed-origins">Allowed Origins</h2>
          <Button
            variant={showOriginForm ? 'secondary' : 'primary'}
            onClick={() => setShowOriginForm(!showOriginForm)}
            data-testid="add-origin-btn"
            label={showOriginForm ? 'Cancel' : '+ Add origin'}
          />
        </div>

        {showOriginForm && (
          <div className="create-form-container" data-testid="add-origin-form">
            <form onSubmit={handleAddOrigin} className="create-form">
              <div className="form-fields">
                <TextInput
                  id="origin-input"
                  label="Allowed origin"
                  value={newOriginValue}
                  onChange={(e) => setNewOriginValue(e.target.value)}
                  placeholder="https://example.com or *-mysite.pantheonsite.io"
                  inputProps={{ autoFocus: true }}
                  data-testid="origin-input"
                />
              </div>
              <Button
                variant="primary"
                buttonType="submit"
                onClick={() => {}}
                disabled={isUpdatingOrigins || !newOriginValue.trim() || (site?.allowedOrigins ?? []).includes(newOriginValue.trim())}
                isLoading={isUpdatingOrigins}
                data-testid="submit-origin-btn"
                label={isUpdatingOrigins ? 'Adding...' : 'Add'}
              />
            </form>
            {updateOriginsError && (
              <InlineMessage type="critical" className="create-error-alert" data-testid="add-origin-error" title={updateOriginsError} />
            )}
          </div>
        )}

        {(site?.allowedOrigins ?? []).length > 0 ? (
          <table data-testid="allowed-origins-table">
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
                      variant="critical"
                      onClick={() => setOriginToRemove(origin)}
                      data-testid={`remove-origin-${index}`}
                      label="Remove"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div data-testid="allowed-origins-empty">
            <p data-testid="allowed-origins-empty-warning">
              No allowed origins configured. OAuth login will be blocked until at least one origin is added.
            </p>
          </div>
        )}
      </Panel>

      {/* Settings Section */}
      <Panel data-testid="settings-section">
        <div className="section-header">
          <h2 className="section-title" data-testid="section-title-settings">Settings</h2>
        </div>
        <CacheSettings
          settings={siteSettings}
          isLoading={settingsLoading}
          onSave={handleSaveSettings}
          isSaving={isUpdatingSettings}
        />
      </Panel>

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

      <ConfirmDeleteModal
        isOpen={confirmDeleteSite}
        resourceType="site"
        resourceName={site?.name ?? ''}
        onConfirm={handleDeleteSite}
        onCancel={() => setConfirmDeleteSite(false)}
        isDeleting={isDeletingSite}
        error={deleteSiteError}
      />
    </div>
  );
}

interface IconProps {
  className?: string;
}

function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
