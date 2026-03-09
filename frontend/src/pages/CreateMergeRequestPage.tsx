/**
 * Create Merge Request Page
 *
 * Form to create a new merge request.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getSite } from '../api/sites';
import { listBranches } from '../api/branches';
import { createMergeRequest } from '../api/merge-requests';
import type { CreateMergeRequestParams } from '../api/merge-requests';
import { ApiResponse } from '../components/ApiResponse';
import type { Site, Branch, MergeRequest } from '../types';
import {
  Button,
  RouterLinkButton,
  Alert,
} from '@pantheon-systems/design-toolkit-react';
import './CreateMergeRequestPage.css';

export function CreateMergeRequestPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();

  const [sourceBranchId, setSourceBranchId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data: site, isLoading: siteLoading, error: siteError, execute: fetchSite } =
    useApi<Site, [string]>(getSite);
  const { data: branches, isLoading: branchesLoading, execute: fetchBranches } =
    useApi<Branch[], [string]>(listBranches);
  const { execute: createMR, isLoading: isCreating, error: createError } =
    useApi<MergeRequest, [string, CreateMergeRequestParams]>(createMergeRequest);

  useEffect(() => {
    if (siteId) {
      fetchSite(siteId);
      fetchBranches(siteId);
    }
  }, [siteId, fetchSite, fetchBranches]);

  const mainBranch = branches?.find((b) => b.isMain);
  const targetBranchId = mainBranch?.id ?? '';
  const activeBranches = branches?.filter((b) => b.status === 'active') || [];

  const validateForm = (): boolean => {
    if (!sourceBranchId) {
      setValidationError('Please select a source branch');
      return false;
    }
    if (sourceBranchId === targetBranchId) {
      setValidationError('Source and target branches must be different');
      return false;
    }
    if (!title.trim()) {
      setValidationError('Please enter a title');
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId || !validateForm()) return;

    const params: CreateMergeRequestParams = {
      sourceBranchId,
      targetBranchId,
      title: title.trim(),
    };
    if (description.trim()) {
      params.description = description.trim();
    }

    const result = await createMR(siteId, params);
    if (result) {
      navigate(`/sites/${siteId}/merge-requests/${result.id}`);
    }
  };

  const handleCancel = () => {
    navigate(`/sites/${siteId}/merge-requests`);
  };

  if (siteLoading) {
    return (
      <div className="create-mr-page">
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      </div>
    );
  }

  if (siteError) {
    return (
      <div className="create-mr-page">
        <div className="error-container">
          <ApiResponse data={null} isLoading={false} error={siteError} />
          <div className="back-link-container">
            <RouterLinkButton to="/sites" type="secondary" data-testid="back-to-sites">
              Back to sites
            </RouterLinkButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="create-mr-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/sites">Sites</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/sites/${siteId}/merge-requests`}>Merge Requests</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">New</span>
      </nav>

      {/* Page Header */}
      <header className="page-header">
        <h1 className="page-title">Create Merge Request</h1>
      </header>

      {/* Form */}
      <section className="form-section">
        <form onSubmit={handleSubmit} className="mr-form" data-testid="create-mr-form">
          <div className="form-group">
            <label htmlFor="sourceBranch" className="form-label">
              Source Branch <span className="required">*</span>
            </label>
            <select
              id="sourceBranch"
              value={sourceBranchId}
              onChange={(e) => setSourceBranchId(e.target.value)}
              className="pds-select"
              disabled={branchesLoading}
              data-testid="source-branch-select"
            >
              <option value="">Select source branch...</option>
              {activeBranches
                .filter((branch) => !branch.isMain)
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
            <p className="form-help">The branch containing changes you want to merge</p>
          </div>

          <div className="form-group">
            <label htmlFor="targetBranch" className="form-label">
              Target Branch <span className="required">*</span>
            </label>
            <select
              id="targetBranch"
              value={targetBranchId}
              onChange={(e) => setTargetBranchId(e.target.value)}
              className="pds-select"
              disabled
              data-testid="target-branch-select"
            >
              <option value="">Select target branch...</option>
              {activeBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <p className="form-help">All merge requests target the main branch</p>
          </div>

          <div className="form-group">
            <label htmlFor="title" className="form-label">
              Title <span className="required">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="pds-input"
              placeholder="Enter a descriptive title..."
              data-testid="title-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="description" className="form-label">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="pds-input pds-textarea"
              placeholder="Describe the changes in this merge request..."
              rows={4}
              data-testid="description-input"
            />
          </div>

          {(validationError || createError) && (
            <Alert type="danger" data-testid="form-error">
              {validationError || createError}
            </Alert>
          )}

          <div className="form-actions">
            <Button
              type="secondary"
              onClick={handleCancel}
              disabled={isCreating}
              data-testid="cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="primary"
              isSubmit
              onClick={() => {}}
              disabled={isCreating}
              isLoading={isCreating}
              data-testid="submit-btn"
            >
              {isCreating ? 'Creating...' : 'Create Merge Request'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
