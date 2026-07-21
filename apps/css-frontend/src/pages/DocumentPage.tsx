/**
 * Document Detail Page
 *
 * Displays document details, content (as JSON), and version history.
 * Supports editing when viewed in branch context.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { getBranch } from '../api/branches';
import { getDocument, getLatestDocumentVersion, listDocumentVersions, createDocumentVersion } from '../api/documents';
import type { DocumentVersion } from '../api/documents';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, Document, Branch } from '../types';
import {
  Breadcrumb,
  Button,
  ButtonLink,
  CompactEmptyState,
  InlineMessage,
  Panel,
  StatusBadge,
  Tabs,
  Textarea,
} from '@pantheon-systems/pds-toolkit-react';
import './DocumentPage.css';

export function DocumentPage() {
  const { siteId, branchId, documentId } = useParams<{
    siteId: string;
    branchId?: string;
    documentId: string;
  }>();

  // State
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  // API hooks
  const { data: site, execute: fetchSite } = useApi<Site, [string]>(getSite);
  const { data: branch, execute: fetchBranch } = useApi<Branch, [string, string]>(getBranch);
  const { data: document, isLoading, error, execute: fetchDocument } =
    useApi<Document, [string, string]>(getDocument);
  const { data: latestVersion, isLoading: versionLoading, error: versionError, execute: fetchLatestVersion } =
    useApi<DocumentVersion, [string, string, string]>(getLatestDocumentVersion);
  const { data: versions, isLoading: versionsLoading, execute: fetchVersions } =
    useApi<DocumentVersion[], [string, string, string]>(listDocumentVersions);
  const { execute: saveVersion, isLoading: isSaving, error: saveError } =
    useApi<DocumentVersion, [string, string, string, { snapshot: Record<string, unknown> }]>(createDocumentVersion);

  // Check if we're in branch context (can edit)
  const hasBranchContext = Boolean(branchId);

  // Fetch data on mount
  useEffect(() => {
    if (siteId && documentId) {
      fetchSite(siteId);
      fetchDocument(siteId, documentId);
    }
  }, [siteId, documentId, fetchSite, fetchDocument]);

  // Fetch branch and version data when we have branch context
  useEffect(() => {
    if (siteId && branchId && documentId) {
      fetchBranch(siteId, branchId);
      fetchLatestVersion(siteId, branchId, documentId);
      fetchVersions(siteId, branchId, documentId);
    }
  }, [siteId, branchId, documentId, fetchBranch, fetchLatestVersion, fetchVersions]);

  // Get the content string from latest version (computed value, not state)
  const latestContentString = latestVersion?.snapshot
    ? JSON.stringify(latestVersion.snapshot, null, 2)
    : '{}';

  const handleEdit = useCallback(() => {
    // Initialize edit content when entering edit mode
    setEditContent(latestContentString);
    setIsEditing(true);
    setJsonError(null);
  }, [latestContentString]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setJsonError(null);
    // Reset to latest version content
    setEditContent(latestContentString);
  }, [latestContentString]);

  const handleContentChange = useCallback((value: string) => {
    setEditContent(value);
    // Validate JSON in real-time
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      if (e instanceof Error) {
        setJsonError(e.message);
      } else {
        setJsonError('Invalid JSON');
      }
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!siteId || !branchId || !documentId) return;

    try {
      const parsed = JSON.parse(editContent);

      // Validate it's an object, not an array or primitive
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setJsonError('Snapshot must be a JSON object');
        return;
      }

      const result = await saveVersion(siteId, branchId, documentId, { snapshot: parsed });
      if (result) {
        setIsEditing(false);
        setJsonError(null);
        // Refresh version data
        fetchLatestVersion(siteId, branchId, documentId);
        fetchVersions(siteId, branchId, documentId);
      }
    } catch (e) {
      if (e instanceof Error) {
        setJsonError(e.message);
      }
    }
  }, [siteId, branchId, documentId, editContent, saveVersion, fetchLatestVersion, fetchVersions]);

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '-';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return '-';
    }
  };

  const getSourceBadgeClass = (source: string): string => {
    switch (source) {
      case 'edit':
        return 'source-badge source-edit';
      case 'merge':
        return 'source-badge source-merge';
      case 'revert':
        return 'source-badge source-revert';
      case 'checkpoint':
        return 'source-badge source-checkpoint';
      case 'publish':
        return 'source-badge source-publish';
      default:
        return 'source-badge';
    }
  };

  if (isLoading) {
    return (
      <div className="document-page">
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="document-page">
        <div className="error-container">
          <ApiResponse data={null} isLoading={false} error={error} />
          <div className="back-link-container">
            <ButtonLink
              variant="secondary"
              linkContent={<Link to={`/sites/${siteId}`}>Back to site</Link>}
              data-testid="back-to-site-btn"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="document-page">
      {/* Breadcrumb */}
      <Breadcrumb
        crumbs={[
          <Link to="/sites">Sites</Link>,
          <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>,
          ...(hasBranchContext && branch
            ? [<Link to={`/sites/${siteId}/branches/${branchId}`}>{branch.name}</Link>]
            : []),
          <span>Document</span>,
        ]}
      />

      {/* Document Info Header */}
      <Panel data-testid="document-header-panel">
        <div className="document-info">
          <div className="document-title-row">
            <h1 className="document-title">
              <code>{document?.path}</code>
            </h1>
            {latestVersion?.isTombstone === true && (
              <StatusBadge label="Deleted" color="neutral" data-testid="deleted-tag" />
            )}
            {document?.archivedAt && (
              <StatusBadge label="Archived" color="neutral" />
            )}
            {versions && versions.length > 0 && !versions.some((v) => v.isPublished === true) && (
              <StatusBadge label="Unpublished" color="neutral" data-testid="unpublished-tag" />
            )}
          </div>
          <div className="document-meta">
            <span className="meta-item">
              <strong>ID:</strong> <code>{document?.id}</code>
            </span>
            {hasBranchContext && branch && (
              <span className="meta-item">
                <strong>Branch:</strong> <code>{branch.name}</code>
              </span>
            )}
            {latestVersion && (
              <span className="meta-item">
                <strong>Version:</strong> <code>v{latestVersion.versionNumber}</code>
              </span>
            )}
          </div>
        </div>
      </Panel>

      {/* Branch Context Notice */}
      {!hasBranchContext && (
        <InlineMessage
          type="warning"
          title="Viewing document without branch context. To view or edit content, access this document from a branch."
          className="notice-alert"
          data-testid="no-branch-notice"
        />
      )}

      {/* Tabs */}
      {hasBranchContext && (
        <Tabs
          ariaLabel="Document sections"
          selectedTab={activeTab}
          onActiveTabChange={setActiveTab}
          tabs={[
            {
              tabLabel: 'Content',
              tabId: 'content',
              panelContent: (
                <Panel>
                  <div className="section-header">
                    <h2 className="section-title">Document Content</h2>
                    <div className="header-actions">
                      {!isEditing ? (
                        <Button
                          variant="primary"
                          label="Edit"
                          onClick={handleEdit}
                          disabled={versionLoading}
                          data-testid="edit-btn"
                        />
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            label="Cancel"
                            onClick={handleCancel}
                            disabled={isSaving}
                            data-testid="cancel-btn"
                          />
                          <Button
                            variant="primary"
                            label={isSaving ? 'Saving...' : 'Save'}
                            onClick={handleSave}
                            disabled={isSaving || Boolean(jsonError)}
                            isLoading={isSaving}
                            data-testid="save-btn"
                          />
                        </>
                      )}
                    </div>
                  </div>

                  {versionLoading ? (
                    <div className="loading-container">
                      <ApiResponse data={null} isLoading={true} error={null} />
                    </div>
                  ) : versionError ? (
                    <div className="error-banner">
                      <ApiResponse data={null} isLoading={false} error={versionError} />
                    </div>
                  ) : (
                    <div className="content-viewer">
                      {isEditing ? (
                        <>
                          <Textarea
                            id="json-editor"
                            label="JSON content editor"
                            value={editContent}
                            onChange={(e) => handleContentChange(e.target.value)}
                            validationStatus={jsonError ? 'error' : undefined}
                            validationMessage={jsonError || undefined}
                            data-testid="json-editor"
                          />
                          {jsonError && (
                            <InlineMessage
                              type="critical"
                              title={jsonError}
                              className="json-error-alert"
                              data-testid="json-error"
                            />
                          )}
                          {saveError && (
                            <InlineMessage
                              type="critical"
                              title={saveError}
                              className="save-error-alert"
                              data-testid="save-error"
                            />
                          )}
                        </>
                      ) : (
                        <div className="json-placeholder">
                          <pre className="json-content" data-testid="json-content">
                            {latestVersion?.snapshot
                              ? JSON.stringify(latestVersion.snapshot, null, 2)
                              : '{}'}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {latestVersion && !isEditing && (
                    <div className="version-info">
                      <span className="version-meta">
                        Last saved by <code>{latestVersion.createdById.slice(0, 8)}...</code>
                        {' '}on {formatDate(latestVersion.createdAt)}
                      </span>
                    </div>
                  )}
                </Panel>
              ),
            },
            {
              tabLabel: `Version History ${versions ? `(${versions.length})` : ''}`,
              tabId: 'history',
              panelContent: (
                <Panel>
                  <div className="section-header">
                    <h2 className="section-title">Version History</h2>
                  </div>

                  {versionsLoading ? (
                    <div className="loading-container">
                      <ApiResponse data={null} isLoading={true} error={null} />
                    </div>
                  ) : versions && versions.length > 0 ? (
                    <table data-testid="versions-table">
                      <thead>
                        <tr>
                          <th>Version</th>
                          <th>Source</th>
                          <th>Created By</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {versions.map((version) => (
                          <tr key={version.id} className={version.id === latestVersion?.id ? 'current-version' : ''}>
                            <td className="version-number">
                              <code>v{version.versionNumber}</code>
                              {version.id === latestVersion?.id && (
                                <span className="current-badge">Current</span>
                              )}
                              {version.isPublished === true && (
                                <span className="published-badge">Published</span>
                              )}
                              {version.sourceBranchName != null && (
                                <span className="provenance-badge">from {version.sourceBranchName}</span>
                              )}
                              {version.publishedToVersionId != null && (
                                <span className="published-to-main-badge">Published to main</span>
                              )}
                            </td>
                            <td>
                              <span className={getSourceBadgeClass(version.source)}>
                                {version.source}
                              </span>
                            </td>
                            <td className="created-by">
                              <code>{version.createdById.slice(0, 12)}...</code>
                              <span className="creator-type">({version.createdByType})</span>
                            </td>
                            <td className="date">
                              {formatDate(version.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <CompactEmptyState
                      iconName="emptySet"
                      heading="No versions found"
                      message="No versions found for this document on this branch."
                      data-testid="versions-empty"
                    />
                  )}
                </Panel>
              ),
            },
          ]}
        />
      )}

      {/* Document Details Section (always shown) */}
      <Panel>
        <div className="section-header">
          <h2 className="section-title">Document Details</h2>
        </div>

        <div className="details-grid">
          <div className="detail-item">
            <label className="detail-label">Path</label>
            <div className="detail-value">
              <code>{document?.path}</code>
            </div>
          </div>

          <div className="detail-item">
            <label className="detail-label">Document ID</label>
            <div className="detail-value">
              <code>{document?.id}</code>
            </div>
          </div>

          <div className="detail-item">
            <label className="detail-label">Created</label>
            <div className="detail-value">
              {formatDate(document?.createdAt)}
            </div>
          </div>

          <div className="detail-item">
            <label className="detail-label">Status</label>
            <div className="detail-value">
              {latestVersion?.isTombstone === true ? (
                <StatusBadge label="Deleted" color="neutral" />
              ) : document?.archivedAt ? (
                <StatusBadge label={`Archived on ${formatDate(document.archivedAt)}`} color="neutral" />
              ) : (
                <StatusBadge label="Active" color="neutral" />
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
