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
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { Site, Branch } from '../types';
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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [selectedParentBranch, setSelectedParentBranch] = useState<string>('');
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);
  const [archivingBranchId, setArchivingBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (siteId) {
      fetchSite(siteId);
      fetchBranches(siteId);
    }
  }, [siteId, fetchSite, fetchBranches]);

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
      <nav className="breadcrumb">
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
          <h2 className="section-title">Branches</h2>
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

      <ConfirmDeleteModal
        isOpen={branchToDelete !== null}
        resourceType="branch"
        resourceName={branchToDelete?.name ?? ''}
        onConfirm={handleDeleteBranch}
        onCancel={() => setBranchToDelete(null)}
        isDeleting={isDeleting}
        error={deleteError}
      />
    </div>
  );
}
