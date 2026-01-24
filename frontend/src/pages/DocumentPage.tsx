/**
 * Document Detail Page
 *
 * Displays document details and metadata.
 * Future: Will show version history and document content.
 */

import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { getDocument } from '../api/documents';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, Document } from '../types';
import './DocumentPage.css';

export function DocumentPage() {
  const { siteId, documentId } = useParams<{ siteId: string; documentId: string }>();

  const { data: site, execute: fetchSite } = useApi<Site, [string]>(getSite);
  const { data: document, isLoading, error, execute: fetchDocument } =
    useApi<Document, [string, string]>(getDocument);

  useEffect(() => {
    if (siteId && documentId) {
      fetchSite(siteId);
      fetchDocument(siteId, documentId);
    }
  }, [siteId, documentId, fetchSite, fetchDocument]);

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '-';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return '-';
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
          <Link to={`/sites/${siteId}`} className="back-link">Back to Site</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="document-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/sites">Sites</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">Document</span>
      </nav>

      {/* Document Info Header */}
      <header className="document-header">
        <div className="document-info">
          <div className="document-title-row">
            <h1 className="document-title">
              <code>{document?.path}</code>
            </h1>
            {document?.archivedAt && (
              <span className="status-badge status-archived">Archived</span>
            )}
          </div>
          <div className="document-meta">
            <span className="meta-item">
              <strong>ID:</strong> <code>{document?.id}</code>
            </span>
            <span className="meta-item">
              <strong>Site ID:</strong> <code>{document?.siteId}</code>
            </span>
          </div>
        </div>
      </header>

      {/* Document Details Section */}
      <section className="content-section">
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
            <label className="detail-label">Last Updated</label>
            <div className="detail-value">
              {formatDate(document?.updatedAt)}
            </div>
          </div>

          <div className="detail-item">
            <label className="detail-label">Status</label>
            <div className="detail-value">
              {document?.archivedAt ? (
                <span className="status-indicator status-archived-text">
                  Archived on {formatDate(document.archivedAt)}
                </span>
              ) : (
                <span className="status-indicator status-active-text">Active</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Placeholder for future features */}
      <section className="content-section coming-soon-section">
        <div className="section-header">
          <h2 className="section-title">Version History</h2>
        </div>
        <div className="coming-soon">
          <div className="coming-soon-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3>Version History Coming Soon</h3>
          <p>Track all changes made to this document across branches.</p>
        </div>
      </section>

      <section className="content-section">
        <div className="section-header">
          <h2 className="section-title">Document Content</h2>
        </div>
        <div className="content-viewer">
          <div className="json-placeholder">
            <pre className="json-content">
              {JSON.stringify(
                {
                  _note: "Document content stored in document versions",
                  documentId: document?.id,
                  path: document?.path,
                  status: document?.archivedAt ? "archived" : "active",
                  message: "Content API endpoint coming soon. Document versions store the actual JSON content.",
                },
                null,
                2
              )}
            </pre>
          </div>
          <p className="content-note">
            Document content is stored in document versions. Each edit creates a new version with a snapshot of the content.
          </p>
        </div>
      </section>
    </div>
  );
}
