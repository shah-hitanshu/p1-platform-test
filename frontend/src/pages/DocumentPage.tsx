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

      <section className="content-section coming-soon-section">
        <div className="section-header">
          <h2 className="section-title">Document Content</h2>
        </div>
        <div className="coming-soon">
          <div className="coming-soon-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <h3>Document Content Viewer Coming Soon</h3>
          <p>View and edit document JSON content in a visual editor.</p>
        </div>
      </section>
    </div>
  );
}
