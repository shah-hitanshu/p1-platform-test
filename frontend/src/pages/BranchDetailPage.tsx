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
  Button,
  RouterLinkButton,
  Alert,
  Tag,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from '@pantheon-systems/design-toolkit-react';
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
  const [activeTabIndex, setActiveTabIndex] = useState(0);

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

  const getCheckpointTypeTagType = (type: Checkpoint['type']): 'info' | 'default' | 'success' => {
    switch (type) {
      case 'manual':
        return 'info';
      case 'auto':
        return 'default';
      case 'merge':
        return 'success';
      default:
        return 'default';
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
          <div className="back-link-container">
            <RouterLinkButton to={`/sites/${siteId}`} type="secondary">
              Back to site
            </RouterLinkButton>
          </div>
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
              <Tag type={getStatusTagType(branch.status)} data-testid="branch-status-badge">
                {branch.status}
              </Tag>
            )}
          </div>
          <div className="branch-meta">
            <span className="meta-item">
              <strong>ID:</strong> <code>{branch?.id}</code>
            </span>
            <span className="meta-item">
              <strong>Parent:</strong>{' '}
              {branch?.sourceBranchId ? (
                <code>{branch.sourceBranchId.slice(0, 8)}...</code>
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
      <Tabs index={activeTabIndex} onChange={setActiveTabIndex}>
        <TabList>
          <Tab data-testid="checkpoints-tab">
            Checkpoints {checkpoints ? `(${checkpoints.length})` : ''}
          </Tab>
          <Tab data-testid="documents-tab">
            Documents {documents ? `(${documents.length})` : ''}
          </Tab>
        </TabList>
        <TabPanels>
          {/* Checkpoints Tab */}
          <TabPanel>
            <section className="content-section">
          <div className="section-header">
            <h2 className="section-title">Checkpoints</h2>
            <Button
              type={showCheckpointForm ? 'secondary' : 'primary'}
              onClick={() => setShowCheckpointForm(!showCheckpointForm)}
              data-testid="create-checkpoint-btn"
            >
              {showCheckpointForm ? 'Cancel' : '+ Create checkpoint'}
            </Button>
          </div>

          {showCheckpointForm && (
            <div className="create-form-container" data-testid="checkpoint-form">
              <form onSubmit={handleCreateCheckpoint} className="create-form">
                <input
                  type="text"
                  value={checkpointName}
                  onChange={(e) => setCheckpointName(e.target.value)}
                  placeholder="Checkpoint name (optional)..."
                  className="pds-input"
                  autoFocus
                  aria-label="Checkpoint name"
                  data-testid="checkpoint-name-input"
                />
                <Button
                  type="primary"
                  isSubmit
                  onClick={() => {}}
                  disabled={isCreatingCheckpoint}
                  isLoading={isCreatingCheckpoint}
                  data-testid="submit-checkpoint-btn"
                >
                  {isCreatingCheckpoint ? 'Creating...' : 'Create'}
                </Button>
              </form>
              {createCheckpointError && (
                <Alert type="danger" className="create-error-alert" data-testid="checkpoint-error">
                  {createCheckpointError}
                </Alert>
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
              <table className="data-table" data-testid="checkpoints-table">
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
                        <Tag type={getCheckpointTypeTagType(checkpoint.type)}>
                          {checkpoint.type}
                        </Tag>
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
            <div className="empty-state" data-testid="checkpoints-empty">
              <p>No checkpoints found. Create a checkpoint to save the current state.</p>
            </div>
          )}
            </section>
          </TabPanel>

          {/* Documents Tab */}
          <TabPanel>
            <section className="content-section">
          <div className="section-header">
            <h2 className="section-title">Documents</h2>
            <Button
              type={showDocumentForm ? 'secondary' : 'primary'}
              onClick={() => setShowDocumentForm(!showDocumentForm)}
              data-testid="create-document-btn"
            >
              {showDocumentForm ? 'Cancel' : '+ Create document'}
            </Button>
          </div>

          {showDocumentForm && (
            <div className="create-form-container" data-testid="document-form">
              <form onSubmit={handleCreateDocument} className="create-form">
                <input
                  type="text"
                  value={documentPath}
                  onChange={(e) => setDocumentPath(e.target.value)}
                  placeholder="Document path (e.g., pages/home)..."
                  className="pds-input"
                  autoFocus
                  aria-label="Document path"
                  data-testid="document-path-input"
                />
                <Button
                  type="primary"
                  isSubmit
                  onClick={() => {}}
                  disabled={isCreatingDocument || !documentPath.trim()}
                  isLoading={isCreatingDocument}
                  data-testid="submit-document-btn"
                >
                  {isCreatingDocument ? 'Creating...' : 'Create'}
                </Button>
              </form>
              {createDocumentError && (
                <Alert type="danger" className="create-error-alert" data-testid="document-error">
                  {createDocumentError}
                </Alert>
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
            <div className="table-container">
              <table className="data-table" data-testid="documents-table">
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
                          type="danger"
                          onClick={() => handleDeleteDocument(doc.id)}
                          disabled={isDeletingDocument}
                          data-testid={`delete-doc-${doc.id}`}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state" data-testid="documents-empty">
              <p>No documents found on this branch.</p>
            </div>
          )}
            </section>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  );
}
