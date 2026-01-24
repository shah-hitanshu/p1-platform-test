/**
 * Site Detail Page
 *
 * Displays a single site with its branches list.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listBranches, createBranch, deleteBranch as deleteBranchApi } from '../api/branches';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { Site, Branch } from '../types';
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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [selectedParentBranch, setSelectedParentBranch] = useState<string>('');
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null);

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

  const getStatusBadgeClass = (status: Branch['status']) => {
    switch (status) {
      case 'active':
        return 'status-badge status-active';
      case 'merged':
        return 'status-badge status-merged';
      case 'archived':
        return 'status-badge status-archived';
      case 'abandoned':
        return 'status-badge status-abandoned';
      default:
        return 'status-badge';
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
          <Link to="/sites" className="back-link">Back to sites</Link>
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
          <h1 className="site-title">{site?.name}</h1>
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
        <Link to={`/sites/${siteId}/merge-requests`} className="merge-requests-link">
          Merge Requests
        </Link>
      </header>

      {/* Branches Section */}
      <section className="branches-section">
        <div className="section-header">
          <h2 className="section-title">Branches</h2>
          <button
            className="create-btn"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? 'Cancel' : '+ Create branch'}
          </button>
        </div>

        {showCreateForm && (
          <div className="create-form-container">
            <form onSubmit={handleCreateBranch} className="create-form">
              <div className="form-fields">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Enter branch name..."
                  className="form-input"
                  autoFocus
                />
                <select
                  value={selectedParentBranch}
                  onChange={(e) => setSelectedParentBranch(e.target.value)}
                  className="form-select"
                >
                  <option value="">No parent (main branch)</option>
                  {branches?.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="submit-btn"
                disabled={isCreating || !newBranchName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </form>
            {createError && (
              <div className="create-error">
                <span className="error-icon">!</span>
                <span className="error-text">{createError}</span>
              </div>
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
            <table className="branches-table">
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
                  <tr key={branch.id}>
                    <td className="branch-name">{branch.name}</td>
                    <td>
                      <span className={getStatusBadgeClass(branch.status)}>
                        {branch.status}
                      </span>
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
                      <Link
                        to={`/sites/${siteId}/branches/${branch.id}`}
                        className="view-link"
                      >
                        View
                      </Link>
                      {!branch.name.includes('main') && (
                        <button
                          className="delete-link"
                          onClick={() => setBranchToDelete(branch)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
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
