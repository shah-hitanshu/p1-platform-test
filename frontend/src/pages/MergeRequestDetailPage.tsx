/**
 * Merge Request Detail Page
 *
 * Displays merge request details and provides actions based on status.
 */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listBranches } from '../api/branches';
import {
  getMergeRequest,
  updateMergeRequest,
  deleteMergeRequest,
  executeMerge,
} from '../api/merge-requests';
import type { UpdateMergeRequestParams, ExecuteMergeParams } from '../api/merge-requests';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ConflictList } from '../components/ConflictList';
import { MergePreviewPanel } from '../components/MergePreviewPanel';
import { ConflictResolutionPanel } from '../components/ConflictResolutionPanel';
import type { ConflictResolution } from '../api/merge-requests';
import type { Site, Branch, MergeRequest, MergeRequestStatus, MergeExecuteResult } from '../types';
import './MergeRequestDetailPage.css';

export function MergeRequestDetailPage() {
  const { siteId, requestId } = useParams<{ siteId: string; requestId: string }>();
  const navigate = useNavigate();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResolutionPanel, setShowResolutionPanel] = useState(false);

  const { data: site, isLoading: siteLoading, error: siteError, execute: fetchSite } =
    useApi<Site, [string]>(getSite);
  const { data: mergeRequest, isLoading: mrLoading, error: mrError, execute: fetchMergeRequest } =
    useApi<MergeRequest, [string, string]>(getMergeRequest);
  const { data: branches, execute: fetchBranches } =
    useApi<Branch[], [string]>(listBranches);
  const { execute: updateMR, isLoading: isUpdating, error: updateError } =
    useApi<MergeRequest, [string, string, UpdateMergeRequestParams]>(updateMergeRequest);
  const { execute: deleteMR, isLoading: isDeleting, error: deleteError } =
    useApi<void, [string, string]>(deleteMergeRequest);
  const { execute: execMerge, isLoading: isMerging, error: mergeError } =
    useApi<MergeExecuteResult, [string, ExecuteMergeParams]>(executeMerge);

  useEffect(() => {
    if (siteId && requestId) {
      fetchSite(siteId);
      fetchMergeRequest(siteId, requestId);
      fetchBranches(siteId);
    }
  }, [siteId, requestId, fetchSite, fetchMergeRequest, fetchBranches]);

  const getBranchName = (branchId: string): string => {
    const branch = branches?.find((b) => b.id === branchId);
    return branch?.name || branchId.slice(0, 8) + '...';
  };

  const getStatusBadgeClass = (status: MergeRequestStatus) => {
    switch (status) {
      case 'open':
        return 'status-badge status-open';
      case 'approved':
        return 'status-badge status-approved';
      case 'conflicted':
        return 'status-badge status-conflicted';
      case 'merged':
        return 'status-badge status-merged';
      case 'closed':
        return 'status-badge status-closed';
      default:
        return 'status-badge';
    }
  };

  const handleStatusChange = async (newStatus: MergeRequestStatus) => {
    if (!siteId || !requestId) return;
    const result = await updateMR(siteId, requestId, { status: newStatus });
    if (result) {
      fetchMergeRequest(siteId, requestId);
    }
  };

  const handleDelete = async () => {
    if (!siteId || !requestId) return;
    await deleteMR(siteId, requestId);
    setShowDeleteModal(false);
    navigate(`/sites/${siteId}/merge-requests`);
  };

  const handleExecuteMerge = async () => {
    if (!siteId || !requestId) return;
    const result = await execMerge(siteId, { mergeRequestId: requestId });
    if (result && result.success) {
      fetchMergeRequest(siteId, requestId);
    }
  };

  const handleResolveConflicts = async (resolutions: ConflictResolution[]) => {
    if (!siteId || !requestId) return;
    const result = await execMerge(siteId, {
      mergeRequestId: requestId,
      resolutions,
    });
    if (result && result.success) {
      setShowResolutionPanel(false);
      fetchMergeRequest(siteId, requestId);
    }
  };

  const renderActions = () => {
    if (!mergeRequest) return null;

    switch (mergeRequest.status) {
      case 'open':
        return (
          <>
            <button
              className="action-btn action-approve"
              onClick={() => handleStatusChange('approved')}
              disabled={isUpdating}
            >
              Approve
            </button>
            <button
              className="action-btn action-close"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating}
            >
              Close
            </button>
            <button
              className="action-btn action-delete"
              onClick={() => setShowDeleteModal(true)}
              disabled={isUpdating}
            >
              Delete
            </button>
          </>
        );
      case 'approved':
        return (
          <>
            <button
              className="action-btn action-merge"
              onClick={handleExecuteMerge}
              disabled={isMerging}
            >
              {isMerging ? 'Merging...' : 'Execute Merge'}
            </button>
            <button
              className="action-btn action-close"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating || isMerging}
            >
              Close
            </button>
          </>
        );
      case 'conflicted':
        return (
          <>
            <button
              className="action-btn action-resolve"
              onClick={() => setShowResolutionPanel(!showResolutionPanel)}
              disabled={isUpdating}
            >
              {showResolutionPanel ? 'Hide Resolution Panel' : 'Resolve Conflicts'}
            </button>
            <button
              className="action-btn action-close"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating}
            >
              Close
            </button>
          </>
        );
      case 'merged':
        return (
          <span className="status-message">This merge request has been merged.</span>
        );
      case 'closed':
        return (
          <>
            <button
              className="action-btn action-reopen"
              onClick={() => handleStatusChange('open')}
              disabled={isUpdating}
            >
              Reopen
            </button>
            <button
              className="action-btn action-delete"
              onClick={() => setShowDeleteModal(true)}
              disabled={isUpdating}
            >
              Delete
            </button>
          </>
        );
      default:
        return null;
    }
  };

  if (siteLoading || mrLoading) {
    return (
      <div className="mr-detail-page">
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      </div>
    );
  }

  if (siteError || mrError) {
    return (
      <div className="mr-detail-page">
        <div className="error-container">
          <ApiResponse data={null} isLoading={false} error={siteError || mrError} />
          <Link to={`/sites/${siteId}/merge-requests`} className="back-link">
            Back to merge requests
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-detail-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/sites">Sites</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}/merge-requests`}>Merge Requests</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{mergeRequest?.title || 'Detail'}</span>
      </nav>

      {/* Header Section */}
      <header className="mr-header">
        <div className="mr-header-top">
          <h1 className="mr-title">{mergeRequest?.title}</h1>
          {mergeRequest && (
            <span className={getStatusBadgeClass(mergeRequest.status)}>
              {mergeRequest.status}
            </span>
          )}
        </div>
        <div className="mr-branches">
          <code className="branch-tag">{getBranchName(mergeRequest?.sourceBranchId || '')}</code>
          <span className="branch-arrow">→</span>
          <code className="branch-tag">{getBranchName(mergeRequest?.targetBranchId || '')}</code>
        </div>
      </header>

      {/* Metadata Section */}
      <section className="mr-metadata">
        <div className="metadata-grid">
          <div className="metadata-item">
            <span className="metadata-label">Created by</span>
            <span className="metadata-value">
              {mergeRequest?.createdByType}: {mergeRequest?.createdById.slice(0, 8)}...
            </span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Created at</span>
            <span className="metadata-value">
              {mergeRequest?.createdAt
                ? new Date(mergeRequest.createdAt).toLocaleString()
                : '-'}
            </span>
          </div>
          {mergeRequest?.mergedAt && (
            <div className="metadata-item">
              <span className="metadata-label">Merged at</span>
              <span className="metadata-value">
                {new Date(mergeRequest.mergedAt).toLocaleString()}
              </span>
            </div>
          )}
          <div className="metadata-item">
            <span className="metadata-label">Updated at</span>
            <span className="metadata-value">
              {mergeRequest?.updatedAt
                ? new Date(mergeRequest.updatedAt).toLocaleString()
                : '-'}
            </span>
          </div>
        </div>
      </section>

      {/* Description Section */}
      <section className="mr-description">
        <h2 className="section-title">Description</h2>
        <div className="description-content">
          {mergeRequest?.description ? (
            <p>{mergeRequest.description}</p>
          ) : (
            <p className="no-description">No description provided.</p>
          )}
        </div>
      </section>

      {/* Actions Section */}
      <section className="mr-actions">
        <h2 className="section-title">Actions</h2>
        <div className="actions-container">
          {renderActions()}
        </div>
        {(updateError || mergeError) && (
          <div className="action-error">
            <span className="error-icon">!</span>
            <span className="error-text">{updateError || mergeError}</span>
          </div>
        )}
      </section>

      {/* Merge Preview */}
      {mergeRequest && siteId && mergeRequest.status !== 'merged' && (
        <section className="mr-preview">
          <MergePreviewPanel
            siteId={siteId}
            sourceBranchId={mergeRequest.sourceBranchId}
            targetBranchId={mergeRequest.targetBranchId}
            sourceBranchName={getBranchName(mergeRequest.sourceBranchId)}
            targetBranchName={getBranchName(mergeRequest.targetBranchId)}
          />
        </section>
      )}

      {/* Conflict Display */}
      {mergeRequest?.hasConflicts && mergeRequest.conflictDetails && (
        <section className="mr-conflicts">
          <h2 className="section-title">Conflicts</h2>
          <p className="conflicts-note">
            This merge request has conflicts that need to be resolved before merging.
          </p>
          <ConflictList conflicts={mergeRequest.conflictDetails.documentConflicts} />
          {showResolutionPanel && (
            <ConflictResolutionPanel
              conflicts={mergeRequest.conflictDetails.documentConflicts}
              onResolve={handleResolveConflicts}
              isResolving={isMerging}
            />
          )}
        </section>
      )}

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        resourceType="merge request"
        resourceName={mergeRequest?.title ?? ''}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
        isDeleting={isDeleting}
        error={deleteError}
      />
    </div>
  );
}
