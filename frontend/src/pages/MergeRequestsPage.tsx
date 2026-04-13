/**
 * Merge Requests Page
 *
 * Lists all merge requests for a site with status filtering.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listMergeRequests } from '../api/merge-requests';
import { listBranches } from '../api/branches';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, MergeRequest, MergeRequestStatus, Branch } from '../types';
import {
  Breadcrumb,
  ButtonLink,
  CompactEmptyState,
  Panel,
  StatusBadge,
} from '@pantheon-systems/pds-toolkit-react';
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
          <div className="back-link-container">
            <ButtonLink variant="secondary" data-testid="back-to-sites" linkContent={<Link to="/sites">Back to sites</Link>} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="merge-requests-page">
      {/* Breadcrumb */}
      <Breadcrumb
        data-testid="breadcrumb"
        crumbs={[
          <Link to="/sites">Sites</Link>,
          <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>,
          <span>Merge Requests</span>,
        ]}
      />

      {/* Page Header */}
      <Panel data-testid="page-header">
        <h1 className="page-title" data-testid="page-title">Merge Requests</h1>
        <ButtonLink
          variant="primary"
          data-testid="create-mr-btn"
          linkContent={<Link to={`/sites/${siteId}/merge-requests/new`}>+ Create merge request</Link>}
        />
      </Panel>

      {/* Status Filter Tabs */}
      <div className="filter-tabs" data-testid="filter-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`filter-tab ${statusFilter === tab.key ? 'active' : ''}`}
            onClick={() => setStatusFilter(tab.key)}
            data-testid={`filter-tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Merge Requests Table */}
      <Panel data-testid="merge-requests-section">
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
          <table data-testid="merge-requests-table">
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
                  data-testid={`mr-row-${mr.id}`}
                >
                  <td className="mr-title">{mr.title}</td>
                  <td className="branch-name">
                    <code>{getBranchName(mr.sourceBranchId)}</code>
                  </td>
                  <td className="branch-name">
                    <code>{getBranchName(mr.targetBranchId)}</code>
                  </td>
                  <td>
                    <StatusBadge label={mr.status} color="neutral" />
                  </td>
                  <td className="mr-date">
                    {new Date(mr.createdAt).toLocaleDateString()}
                  </td>
                  <td className="mr-actions" onClick={(e) => e.stopPropagation()}>
                    <ButtonLink
                      variant="secondary"
                      data-testid={`view-mr-${mr.id}`}
                      linkContent={<Link to={`/sites/${siteId}/merge-requests/${mr.id}`}>View</Link>}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <CompactEmptyState
            data-testid="empty-state"
            title={`No merge requests found${statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.`}
            linkContent={
              <ButtonLink
                variant="secondary"
                data-testid="create-first-mr"
                linkContent={<Link to={`/sites/${siteId}/merge-requests/new`}>Create your first merge request</Link>}
              />
            }
          />
        )}
      </Panel>
    </div>
  );
}
