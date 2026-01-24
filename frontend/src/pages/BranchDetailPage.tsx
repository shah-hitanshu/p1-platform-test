/**
 * Branch Detail Page
 *
 * Displays a single branch with its checkpoints and documents.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { getBranch } from '../api/branches';
import { listCheckpoints, createCheckpoint } from '../api/checkpoints';
import { listDocuments } from '../api/documents';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, Branch, Checkpoint, Document } from '../types';
import './BranchDetailPage.css';

interface CreateCheckpointParams {
  name?: string;
  type?: 'manual' | 'auto' | 'merge';
}

export function BranchDetailPage() {
  const { siteId, branchId } = useParams<{ siteId: string; branchId: string }>();

  const { data: site, execute: fetchSite } = useApi<Site, [string]>(getSite);
  const { data: branch, isLoading: branchLoading, error: branchError, execute: fetchBranch } =
    useApi<Branch, [string, string]>(getBranch);
  const { data: checkpoints, isLoading: checkpointsLoading, error: checkpointsError, execute: fetchCheckpoints } =
    useApi<Checkpoint[], [string, string]>(listCheckpoints);
  const { data: documents, isLoading: documentsLoading, error: documentsError, execute: fetchDocuments } =
    useApi<Document[], [string]>(listDocuments);
  const { execute: createCheckpointRequest, isLoading: isCreatingCheckpoint, error: createCheckpointError } =
    useApi<Checkpoint, [string, string, CreateCheckpointParams?]>(createCheckpoint);

  const [showCheckpointForm, setShowCheckpointForm] = useState(false);
  const [checkpointName, setCheckpointName] = useState('');
  const [activeTab, setActiveTab] = useState<'checkpoints' | 'documents'>('checkpoints');

  useEffect(() => {
    if (siteId && branchId) {
      fetchSite(siteId);
      fetchBranch(siteId, branchId);
      fetchCheckpoints(siteId, branchId);
      fetchDocuments(siteId);
    }
  }, [siteId, branchId, fetchSite, fetchBranch, fetchCheckpoints, fetchDocuments]);

  const handleCreateCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId || !branchId) return;

    const params: CreateCheckpointParams = { type: 'manual' };
    if (checkpointName.trim()) {
      params.name = checkpointName.trim();
    }

    const result = await createCheckpointRequest(siteId, branchId, params);
    if (result) {
      setCheckpointName('');
      setShowCheckpointForm(false);
      fetchCheckpoints(siteId, branchId);
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

  const getCheckpointTypeBadge = (type: Checkpoint['type']) => {
    switch (type) {
      case 'manual':
        return 'type-badge type-manual';
      case 'auto':
        return 'type-badge type-auto';
      case 'merge':
        return 'type-badge type-merge';
      default:
        return 'type-badge';
    }
  };

  if (branchLoading) {
    return (
      <div className="branch-detail-page">
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      </div>
    );
  }

  if (branchError) {
    return (
      <div className="branch-detail-page">
        <div className="error-container">
          <ApiResponse data={null} isLoading={false} error={branchError} />
          <Link to={`/sites/${siteId}`} className="back-link">Back to Site</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="branch-detail-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/sites">Sites</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{branch?.name || 'Branch'}</span>
      </nav>

      {/* Branch Info Header */}
      <header className="branch-header">
        <div className="branch-info">
          <div className="branch-title-row">
            <h1 className="branch-title">{branch?.name}</h1>
            {branch && (
              <span className={getStatusBadgeClass(branch.status)}>
                {branch.status}
              </span>
            )}
          </div>
          <div className="branch-meta">
            <span className="meta-item">
              <strong>ID:</strong> <code>{branch?.id}</code>
            </span>
            <span className="meta-item">
              <strong>Parent:</strong>{' '}
              {branch?.parentBranchId ? (
                <code>{branch.parentBranchId.slice(0, 8)}...</code>
              ) : (
                <span className="no-parent">None (main branch)</span>
              )}
            </span>
            <span className="meta-item">
              <strong>Created:</strong>{' '}
              {branch?.createdAt ? new Date(branch.createdAt).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="tabs-container">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'checkpoints' ? 'active' : ''}`}
            onClick={() => setActiveTab('checkpoints')}
          >
            Checkpoints {checkpoints ? `(${checkpoints.length})` : ''}
          </button>
          <button
            className={`tab ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            Documents {documents ? `(${documents.length})` : ''}
          </button>
        </div>
      </div>

      {/* Checkpoints Tab */}
      {activeTab === 'checkpoints' && (
        <section className="content-section">
          <div className="section-header">
            <h2 className="section-title">Checkpoints</h2>
            <button
              className="create-btn"
              onClick={() => setShowCheckpointForm(!showCheckpointForm)}
            >
              {showCheckpointForm ? 'Cancel' : '+ Create Checkpoint'}
            </button>
          </div>

          {showCheckpointForm && (
            <div className="create-form-container">
              <form onSubmit={handleCreateCheckpoint} className="create-form">
                <input
                  type="text"
                  value={checkpointName}
                  onChange={(e) => setCheckpointName(e.target.value)}
                  placeholder="Checkpoint name (optional)..."
                  className="form-input"
                  autoFocus
                />
                <button
                  type="submit"
                  className="submit-btn"
                  disabled={isCreatingCheckpoint}
                >
                  {isCreatingCheckpoint ? 'Creating...' : 'Create'}
                </button>
              </form>
              {createCheckpointError && (
                <div className="create-error">
                  <span className="error-icon">!</span>
                  <span className="error-text">{createCheckpointError}</span>
                </div>
              )}
            </div>
          )}

          {checkpointsError && (
            <div className="error-banner">
              <ApiResponse data={null} isLoading={false} error={checkpointsError} />
            </div>
          )}

          {checkpointsLoading ? (
            <div className="loading-container">
              <ApiResponse data={null} isLoading={true} error={null} />
            </div>
          ) : checkpoints && checkpoints.length > 0 ? (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Created By</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((checkpoint) => (
                    <tr key={checkpoint.id}>
                      <td className="checkpoint-name">
                        {checkpoint.name || <span className="unnamed">(unnamed)</span>}
                      </td>
                      <td>
                        <span className={getCheckpointTypeBadge(checkpoint.type)}>
                          {checkpoint.type}
                        </span>
                      </td>
                      <td className="created-by">
                        <code>{checkpoint.createdById.slice(0, 12)}...</code>
                      </td>
                      <td className="date">
                        {new Date(checkpoint.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No checkpoints found. Create a checkpoint to save the current state.</p>
            </div>
          )}
        </section>
      )}

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <section className="content-section">
          <div className="section-header">
            <h2 className="section-title">Documents</h2>
          </div>

          {documentsError && (
            <div className="error-banner">
              <ApiResponse data={null} isLoading={false} error={documentsError} />
            </div>
          )}

          {documentsLoading ? (
            <div className="loading-container">
              <ApiResponse data={null} isLoading={true} error={null} />
            </div>
          ) : documents && documents.length > 0 ? (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>ID</th>
                    <th>Created</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td className="doc-path">
                        <code>{doc.path}</code>
                      </td>
                      <td className="doc-id">
                        <code>{doc.id.slice(0, 8)}...</code>
                      </td>
                      <td className="date">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </td>
                      <td className="date">
                        {new Date(doc.updatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No documents found for this site.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
