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
import { listDocumentsOnBranch, createDocumentOnBranch, deleteDocumentOnBranch } from '../api/documents';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, Branch, Checkpoint, Document } from '../types';
import {
  Breadcrumb,
  Button,
  ButtonLink,
  CompactEmptyState,
  InlineMessage,
  Panel,
  StatusBadge,
  Tabs,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
import './BranchDetailPage.css';

interface CreateCheckpointParams {
  name?: string;
  type?: 'manual' | 'auto' | 'merge';
}

interface CreateDocumentParams {
  path: string;
}

export function BranchDetailPage() {
  const { siteId, branchId } = useParams<{ siteId: string; branchId: string }>();

  const { data: site, execute: fetchSite } = useApi<Site, [string]>(getSite);
  const { data: branch, isLoading: branchLoading, error: branchError, execute: fetchBranch } =
    useApi<Branch, [string, string]>(getBranch);
  const { data: checkpoints, isLoading: checkpointsLoading, error: checkpointsError, execute: fetchCheckpoints } =
    useApi<Checkpoint[], [string, string]>(listCheckpoints);
  const { data: documents, isLoading: documentsLoading, error: documentsError, execute: fetchDocuments } =
    useApi<Document[], [string, string]>(listDocumentsOnBranch);
  const { execute: createCheckpointRequest, isLoading: isCreatingCheckpoint, error: createCheckpointError } =
    useApi<Checkpoint, [string, string, CreateCheckpointParams?]>(createCheckpoint);
  const { execute: createDocumentRequest, isLoading: isCreatingDocument, error: createDocumentError } =
    useApi<{ document: Document; version: unknown }, [string, string, CreateDocumentParams]>(createDocumentOnBranch);
  const { execute: deleteDocumentRequest, isLoading: isDeletingDocument } =
    useApi<void, [string, string, string]>(deleteDocumentOnBranch);

  const [showCheckpointForm, setShowCheckpointForm] = useState(false);
  const [checkpointName, setCheckpointName] = useState('');
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [documentPath, setDocumentPath] = useState('');
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    if (siteId && branchId) {
      fetchSite(siteId);
      fetchBranch(siteId, branchId);
      fetchCheckpoints(siteId, branchId);
      fetchDocuments(siteId, branchId);
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

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId || !branchId || !documentPath.trim()) return;

    const result = await createDocumentRequest(siteId, branchId, { path: documentPath.trim() });
    if (result) {
      setDocumentPath('');
      setShowDocumentForm(false);
      fetchDocuments(siteId, branchId);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!siteId || !branchId) return;

    const confirmed = window.confirm(
      'Delete this document from this branch? ' +
      'It will remain visible on other branches.'
    );
    if (!confirmed) return;

    await deleteDocumentRequest(siteId, branchId, documentId);
    fetchDocuments(siteId, branchId);
  };

  const getStatusBadgeColor = (): 'neutral' => {
    return 'neutral';
  };

  const getCheckpointBadgeColor = (): 'neutral' => {
    return 'neutral';
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
          <div className="back-link-container">
            <ButtonLink
              variant="secondary"
              linkContent={<Link to={`/sites/${siteId}`}>Back to site</Link>}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="branch-detail-page">
      {/* Breadcrumb */}
      <Breadcrumb
        data-testid="breadcrumb"
        crumbs={[
          <Link to="/sites">Sites</Link>,
          <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>,
          <span>{branch?.name || 'Branch'}</span>,
        ]}
      />

      {/* Branch Info Header */}
      <Panel>
        <div className="branch-info">
          <div className="branch-title-row">
            <h1 className="branch-title">{branch?.name}</h1>
            {branch && (
              <StatusBadge
                label={branch.status}
                color={getStatusBadgeColor()}
                data-testid="branch-status-badge"
              />
            )}
          </div>
          <div className="branch-meta">
            <span className="meta-item">
              <strong>ID:</strong> <code>{branch?.id}</code>
            </span>
            <span className="meta-item">
              <strong>Source:</strong>{' '}
              {branch?.sourceBranchId ? (
                <span>main</span>
              ) : (
                <span className="no-parent">None (this is the main branch)</span>
              )}
            </span>
            <span className="meta-item">
              <strong>Created:</strong>{' '}
              {branch?.createdAt ? new Date(branch.createdAt).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>
      </Panel>

      {/* Tabs */}
      <Tabs
        ariaLabel="Branch sections"
        selectedTab={activeTab}
        onActiveTabChange={setActiveTab}
        tabs={[
          {
            tabLabel: `Documents ${documents ? `(${documents.length})` : ''}`,
            tabId: 'documents',
            panelContent: (
              <Panel>
                <div className="section-header">
                  <h2 className="section-title" data-testid="section-title-documents">Documents</h2>
                  <Button
                    variant={showDocumentForm ? 'secondary' : 'primary'}
                    label={showDocumentForm ? 'Cancel' : '+ Create document'}
                    onClick={() => setShowDocumentForm(!showDocumentForm)}
                    data-testid="create-document-btn"
                  />
                </div>

                {showDocumentForm && (
                  <div className="create-form-container" data-testid="document-form">
                    <form onSubmit={handleCreateDocument} className="create-form">
                      <TextInput
                        id="document-path"
                        label="Document path"
                        value={documentPath}
                        onChange={(e) => setDocumentPath(e.target.value)}
                        placeholder="Document path (e.g., pages/home)..."
                        autoFocus
                        data-testid="document-path-input"
                      />
                      <Button
                        variant="primary"
                        buttonType="submit"
                        label={isCreatingDocument ? 'Creating...' : 'Create'}
                        onClick={() => {}}
                        disabled={isCreatingDocument || !documentPath.trim()}
                        isLoading={isCreatingDocument}
                        data-testid="submit-document-btn"
                      />
                    </form>
                    {createDocumentError && (
                      <InlineMessage
                        type="critical"
                        title={createDocumentError}
                        className="create-error-alert"
                        data-testid="document-error"
                      />
                    )}
                  </div>
                )}

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
                  <table data-testid="documents-table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>ID</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => (
                        <tr key={doc.id} className="clickable-row">
                          <td className="doc-path">
                            <Link to={`/sites/${siteId}/branches/${branchId}/documents/${doc.id}`} className="doc-link">
                              <code>{doc.path}</code>
                            </Link>
                          </td>
                          <td className="doc-id">
                            <code>{doc.id.slice(0, 8)}...</code>
                          </td>
                          <td className="date">
                            {new Date(doc.createdAt).toLocaleDateString()}
                          </td>
                          <td className="actions">
                            <Button
                              variant="critical"
                              label="Delete"
                              onClick={() => handleDeleteDocument(doc.id)}
                              disabled={isDeletingDocument}
                              data-testid={`delete-doc-${doc.id}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <CompactEmptyState
                    data-testid="documents-empty"
                    iconName="emptySet"
                    heading="No documents found"
                    message="No documents have been created on this branch yet."
                  />
                )}
              </Panel>
            ),
          },
          {
            tabLabel: `Checkpoints ${checkpoints ? `(${checkpoints.length})` : ''}`,
            tabId: 'checkpoints',
            panelContent: (
              <Panel>
                <div className="section-header">
                  <h2 className="section-title" data-testid="section-title-checkpoints">Checkpoints</h2>
                  <Button
                    variant={showCheckpointForm ? 'secondary' : 'primary'}
                    label={showCheckpointForm ? 'Cancel' : '+ Create checkpoint'}
                    onClick={() => setShowCheckpointForm(!showCheckpointForm)}
                    data-testid="create-checkpoint-btn"
                  />
                </div>

                {showCheckpointForm && (
                  <div className="create-form-container" data-testid="checkpoint-form">
                    <form onSubmit={handleCreateCheckpoint} className="create-form">
                      <TextInput
                        id="checkpoint-name"
                        label="Checkpoint name"
                        value={checkpointName}
                        onChange={(e) => setCheckpointName(e.target.value)}
                        placeholder="Checkpoint name (optional)..."
                        autoFocus
                        data-testid="checkpoint-name-input"
                      />
                      <Button
                        variant="primary"
                        buttonType="submit"
                        label={isCreatingCheckpoint ? 'Creating...' : 'Create'}
                        onClick={() => {}}
                        disabled={isCreatingCheckpoint}
                        isLoading={isCreatingCheckpoint}
                        data-testid="submit-checkpoint-btn"
                      />
                    </form>
                    {createCheckpointError && (
                      <InlineMessage
                        type="critical"
                        title={createCheckpointError}
                        className="create-error-alert"
                        data-testid="checkpoint-error"
                      />
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
                  <table data-testid="checkpoints-table">
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
                            <StatusBadge
                              label={checkpoint.type}
                              color={getCheckpointBadgeColor()}
                            />
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
                ) : (
                  <CompactEmptyState
                    data-testid="checkpoints-empty"
                    iconName="emptySet"
                    heading="No checkpoints found"
                    message="Create a checkpoint to save the current state of this branch."
                  />
                )}
              </Panel>
            ),
          },
        ]}
      />
    </div>
  );
}
