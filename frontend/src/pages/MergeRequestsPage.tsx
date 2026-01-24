/**
 * Merge Requests Page
 *
 * Lists all merge requests for a site with status filtering.
 */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listMergeRequests } from '../api/merge-requests';
import { listBranches } from '../api/branches';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, MergeRequest, MergeRequestStatus, Branch } from '../types';
import './MergeRequestsPage.css';

type StatusFilter = 'all' | MergeRequestStatus;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'approved', label: 'Approved' },
  { key: 'conflicted', label: 'Conflicted' },
  { key: 'merged', label: 'Merged' },
  { key: 'closed', label: 'Closed' },
];

export function MergeRequestsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: site, isLoading: siteLoading, error: siteError, execute: fetchSite } =
    useApi<Site, [string]>(getSite);
  const { data: mergeRequests, isLoading: mrLoading, error: mrError, execute: fetchMergeRequests } =
    useApi<MergeRequest[], [string, MergeRequestStatus | undefined]>(listMergeRequests);
  const { data: branches, execute: fetchBranches } =
    useApi<Branch[], [string]>(listBranches);

  useEffect(() => {
    if (siteId) {
      fetchSite(siteId);
      fetchBranches(siteId);
    }
  }, [siteId, fetchSite, fetchBranches]);

  useEffect(() => {
    if (siteId) {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      fetchMergeRequests(siteId, status);
    }
  }, [siteId, statusFilter, fetchMergeRequests]);

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

  if (siteLoading) {
    return (
      <div className="merge-requests-page">
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      </div>
    );
  }

  if (siteError) {
    return (
      <div className="merge-requests-page">
        <div className="error-container">
          <ApiResponse data={null} isLoading={false} error={siteError} />
          <Link to="/sites" className="back-link">Back to sites</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="merge-requests-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/sites">Sites</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">Merge Requests</span>
      </nav>

      {/* Page Header */}
      <header className="page-header">
        <div className="page-info">
          <h1 className="page-title">Merge Requests</h1>
        </div>
        <Link to={`/sites/${siteId}/merge-requests/new`} className="create-btn">
          + Create merge request
        </Link>
      </header>

      {/* Status Filter Tabs */}
      <div className="filter-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`filter-tab ${statusFilter === tab.key ? 'active' : ''}`}
            onClick={() => setStatusFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Merge Requests Table */}
      <section className="merge-requests-section">
        {mrError && (
          <div className="error-banner">
            <ApiResponse data={null} isLoading={false} error={mrError} />
          </div>
        )}

        {mrLoading ? (
          <div className="loading-container">
            <ApiResponse data={null} isLoading={true} error={null} />
          </div>
        ) : mergeRequests && mergeRequests.length > 0 ? (
          <div className="merge-requests-table-container">
            <table className="merge-requests-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Source Branch</th>
                  <th>Target Branch</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mergeRequests.map((mr) => (
                  <tr
                    key={mr.id}
                    className="clickable-row"
                    onClick={() => navigate(`/sites/${siteId}/merge-requests/${mr.id}`)}
                  >
                    <td className="mr-title">{mr.title}</td>
                    <td className="branch-name">
                      <code>{getBranchName(mr.sourceBranchId)}</code>
                    </td>
                    <td className="branch-name">
                      <code>{getBranchName(mr.targetBranchId)}</code>
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(mr.status)}>
                        {mr.status}
                      </span>
                    </td>
                    <td className="mr-date">
                      {new Date(mr.createdAt).toLocaleDateString()}
                    </td>
                    <td className="mr-actions" onClick={(e) => e.stopPropagation()}>
                      <Link
                        to={`/sites/${siteId}/merge-requests/${mr.id}`}
                        className="view-link"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <p>No merge requests found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.</p>
            <Link to={`/sites/${siteId}/merge-requests/new`} className="create-link">
              Create your first merge request
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
