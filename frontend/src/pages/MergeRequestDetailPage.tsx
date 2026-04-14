/**
 * Merge Request Detail Page
 *
 * Displays merge request details and provides actions based on status.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listBranches } from '../api/branches';
import {
  getMergeRequest,
  updateMergeRequest,
  deleteMergeRequest,
  executeMerge,
  previewMerge,
} from '../api/merge-requests';
import type { UpdateMergeRequestParams, ExecuteMergeParams } from '../api/merge-requests';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ConflictList } from '../components/ConflictList';
import { MergePreviewPanel } from '../components/MergePreviewPanel';
import { ConflictResolutionPanel } from '../components/ConflictResolutionPanel';
import type { ConflictResolution } from '../api/merge-requests';
import type { Site, Branch, MergeRequest, MergeRequestStatus, MergeExecuteResult, DocumentDiff } from '../types';
import {
  Breadcrumb,
  Button,
  ButtonLink,
  InlineMessage,
  Panel,
  StatusBadge,
} from '@pantheon-systems/pds-toolkit-react';
import './MergeRequestDetailPage.css';

export function MergeRequestDetailPage() {
  const { siteId, requestId } = useParams<{ siteId: string; requestId: string }>();
  const navigate = useNavigate();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResolutionPanel, setShowResolutionPanel] = useState(false);
  const [documentDiffs, setDocumentDiffs] = useState<DocumentDiff[] | undefined>(undefined);
  const [diffsLoading, setDiffsLoading] = useState(false);
  const diffsLoadedRef = useRef(false);

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

  // Fetch document diffs callback
  const fetchDocumentDiffs = useCallback(async () => {
    if (siteId == null || mergeRequest == null || diffsLoadedRef.current) {
      return;
    }
    diffsLoadedRef.current = true;
    setDiffsLoading(true);
    try {
      const preview = await previewMerge(siteId, {
        sourceBranchId: mergeRequest.sourceBranchId,
        targetBranchId: mergeRequest.targetBranchId,
        includeContent: true,
      });
      setDocumentDiffs(preview.documentDiffs ?? []);
    } catch {
      // Silently fail - diffs are optional enhancement
      setDocumentDiffs([]);
    } finally {
      setDiffsLoading(false);
    }
  }, [siteId, mergeRequest]);

  // Auto-show resolution panel when merge request is conflicted
  useEffect(() => {
    if (mergeRequest?.status === 'conflicted' && mergeRequest.hasConflicts) {
      setShowResolutionPanel(true);
    }
  }, [mergeRequest?.status, mergeRequest?.hasConflicts]);

  // Fetch document diffs when resolution panel is shown
  useEffect(() => {
    if (showResolutionPanel && documentDiffs === undefined && !diffsLoadedRef.current) {
      fetchDocumentDiffs();
    }
  }, [showResolutionPanel, documentDiffs, fetchDocumentDiffs]);

  const getBranchName = (branchId: string): string => {
    const branch = branches?.find((b) => b.id === branchId);
    return branch?.name || branchId.slice(0, 8) + '...';
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
    } else {
      // Re-fetch to pick up conflict details and status changes
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
              variant="primary"
              onClick={() => handleStatusChange('approved')}
              disabled={isUpdating}
              label="Approve"
              data-testid="approve-btn"
            />
            <Button
              variant="secondary"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating}
              label="Close"
              data-testid="close-btn"
            />
            <Button
              variant="critical"
              onClick={() => setShowDeleteModal(true)}
              disabled={isUpdating}
              label="Delete"
              data-testid="delete-btn"
            />
          </>
        );
      case 'approved':
        return (
          <>
            <Button
              variant="primary"
              onClick={handleExecuteMerge}
              disabled={isMerging}
              isLoading={isMerging}
              label={isMerging ? 'Merging...' : 'Execute Merge'}
              data-testid="merge-btn"
            />
            <Button
              variant="secondary"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating || isMerging}
              label="Close"
              data-testid="close-btn"
            />
          </>
        );
      case 'conflicted':
        return (
          <>
            <Button
              variant="primary"
              onClick={() => setShowResolutionPanel(!showResolutionPanel)}
              disabled={isUpdating}
              label={showResolutionPanel ? 'Hide Resolution Panel' : 'Resolve Conflicts'}
              data-testid="resolve-btn"
            />
            <Button
              variant="secondary"
              onClick={() => handleStatusChange('closed')}
              disabled={isUpdating}
              label="Close"
              data-testid="close-btn"
            />
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
              variant="primary"
              onClick={() => handleStatusChange('open')}
              disabled={isUpdating}
              label="Reopen"
              data-testid="reopen-btn"
            />
            <Button
              variant="critical"
              onClick={() => setShowDeleteModal(true)}
              disabled={isUpdating}
              label="Delete"
              data-testid="delete-btn"
            />
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
            <ButtonLink
              variant="secondary"
              data-testid="back-to-merge-requests"
              linkContent={<Link to={`/sites/${siteId}/merge-requests`}>Back to merge requests</Link>}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-detail-page">
      {/* Breadcrumb */}
      <Breadcrumb
        data-testid="breadcrumb"
        crumbs={[
          <Link to="/sites">Sites</Link>,
          <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>,
          <Link to={`/sites/${siteId}/merge-requests`}>Merge Requests</Link>,
          <span>{mergeRequest?.title || 'Detail'}</span>,
        ]}
      />

      {/* Header Section */}
      <Panel>
        <div className="mr-header-top">
          <h1 className="mr-title" data-testid="mr-title">{mergeRequest?.title}</h1>
          {mergeRequest && (
            <StatusBadge label={mergeRequest.status} color="neutral" data-testid="mr-status-badge" />
          )}
        </div>
        <div className="mr-branches" data-testid="mr-branches">
          <code className="branch-tag">{getBranchName(mergeRequest?.sourceBranchId || '')}</code>
          <span className="branch-arrow">→</span>
          <code className="branch-tag">{getBranchName(mergeRequest?.targetBranchId || '')}</code>
        </div>
      </Panel>

      {/* Metadata Section */}
      <Panel data-testid="mr-metadata">
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
      </Panel>

      {/* Description Section */}
      <Panel>
        <h2 className="section-title">Description</h2>
        <div className="description-content">
          {mergeRequest?.description ? (
            <p>{mergeRequest.description}</p>
          ) : (
            <p className="no-description">No description provided.</p>
          )}
        </div>
      </Panel>

      {/* Actions Section */}
      <Panel>
        <h2 className="section-title">Actions</h2>
        <div className="actions-container" data-testid="actions-container">
          {renderActions()}
        </div>
        {(updateError || mergeError) && (
          <InlineMessage type="critical" title={updateError || mergeError || ''} className="action-error-alert" data-testid="action-error" />
        )}
      </Panel>

      {/* Merge Preview */}
      {mergeRequest && siteId && mergeRequest.status !== 'merged' && (
        <Panel>
          <MergePreviewPanel
            siteId={siteId}
            sourceBranchId={mergeRequest.sourceBranchId}
            targetBranchId={mergeRequest.targetBranchId}
            sourceBranchName={getBranchName(mergeRequest.sourceBranchId)}
            targetBranchName={getBranchName(mergeRequest.targetBranchId)}
          />
        </Panel>
      )}

      {/* Conflict Display */}
      {mergeRequest?.hasConflicts && mergeRequest.conflictDetails && (
        <Panel hasStatusIndicator statusType="warning">
          <h2 className="section-title">Conflicts</h2>
          <p className="conflicts-note">
            This merge request has conflicts that need to be resolved before merging.
          </p>
          <ConflictList conflicts={mergeRequest.conflictDetails.documentConflicts} />
          {showResolutionPanel && (
            <ConflictResolutionPanel
              conflicts={mergeRequest.conflictDetails.documentConflicts}
              documentDiffs={documentDiffs}
              onResolve={handleResolveConflicts}
              isResolving={isMerging || diffsLoading}
              sourceBranchName={getBranchName(mergeRequest.sourceBranchId)}
              targetBranchName={getBranchName(mergeRequest.targetBranchId)}
              siteId={siteId}
              sourceBranchId={mergeRequest.sourceBranchId}
              targetBranchId={mergeRequest.targetBranchId}
            />
          )}
        </Panel>
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
