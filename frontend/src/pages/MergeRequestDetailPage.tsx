/**
 * Merge Request Detail Page
 *
 * Displays merge request details and provides actions based on status.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
import {
  Button,
  RouterLinkButton,
  Alert,
  Tag,
} from '@pantheon-systems/design-toolkit-react';
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

  const getStatusTagType = (status: MergeRequestStatus): 'info' | 'success' | 'warning' | 'default' => {
    switch (status) {
      case 'open':
        return 'info';
      case 'approved':
        return 'success';
      case 'conflicted':
        return 'warning';
      case 'merged':
        return 'success';
      case 'closed':
        return 'default';
      default:
        return 'default';
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
    const result = await deleteMR(siteId, requestId);
    // For void functions: undefined = success, null = error
    if (result !== null) {
      setShowDeleteModal(false);
      navigate(`/sites/${siteId}/merge-requests`);
    }
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
            <Button
              type="primary"
              onClick={() => handleStatusChange('approved')}
              disabled={isUpdating}
              data-testid="approve-btn"
            >
              Approve
            </Button>
            <Button
              type="secondary"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating}
              data-testid="close-btn"
            >
              Close
            </Button>
            <Button
              type="danger"
              onClick={() => setShowDeleteModal(true)}
              disabled={isUpdating}
              data-testid="delete-btn"
            >
              Delete
            </Button>
          </>
        );
      case 'approved':
        return (
          <>
            <Button
              type="primary"
              onClick={handleExecuteMerge}
              disabled={isMerging}
              isLoading={isMerging}
              data-testid="merge-btn"
            >
              {isMerging ? 'Merging...' : 'Execute Merge'}
            </Button>
            <Button
              type="secondary"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating || isMerging}
              data-testid="close-btn"
            >
              Close
            </Button>
          </>
        );
      case 'conflicted':
        return (
          <>
            <Button
              type="primary"
              onClick={() => setShowResolutionPanel(!showResolutionPanel)}
              disabled={isUpdating}
              data-testid="resolve-btn"
            >
              {showResolutionPanel ? 'Hide Resolution Panel' : 'Resolve Conflicts'}
            </Button>
            <Button
              type="secondary"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating}
              data-testid="close-btn"
            >
              Close
            </Button>
          </>
        );
      case 'merged':
        return (
          <span className="status-message">This merge request has been merged.</span>
        );
      case 'closed':
        return (
          <>
            <Button
              type="primary"
              onClick={() => handleStatusChange('open')}
              disabled={isUpdating}
              data-testid="reopen-btn"
            >
              Reopen
            </Button>
            <Button
              type="danger"
              onClick={() => setShowDeleteModal(true)}
              disabled={isUpdating}
              data-testid="delete-btn"
            >
              Delete
            </Button>
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
          <div className="back-link-container">
            <RouterLinkButton
              to={`/sites/${siteId}/merge-requests`}
              type="secondary"
              data-testid="back-to-merge-requests"
            >
              Back to merge requests
            </RouterLinkButton>
          </div>
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
            <Tag type={getStatusTagType(mergeRequest.status)} data-testid="mr-status-badge">
              {mergeRequest.status}
            </Tag>
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
      <section className="mr-actions-section">
        <h2 className="section-title">Actions</h2>
        <div className="actions-container" data-testid="actions-container">
          {renderActions()}
        </div>
        {(updateError || mergeError) && (
          <Alert type="danger" className="action-error-alert" data-testid="action-error">
            {updateError || mergeError}
          </Alert>
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
