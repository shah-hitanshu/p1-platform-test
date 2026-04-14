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
  Breadcrumb,
  Button,
  ButtonLink,
  InlineMessage,
  Panel,
  Select,
  Textarea,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
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
            <ButtonLink variant="secondary" data-testid="back-to-sites" linkContent={<Link to="/sites">Back to sites</Link>} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="create-mr-page">
      {/* Breadcrumb */}
      <Breadcrumb
        crumbs={[
          <Link to="/sites">Sites</Link>,
          <Link to={`/sites/${siteId}`}>{site?.name || 'Site'}</Link>,
          <Link to={`/sites/${siteId}/merge-requests`}>Merge Requests</Link>,
          <span>New</span>,
        ]}
      />

      {/* Page Header */}
      <Panel>
        <h1 className="page-title">Create Merge Request</h1>
      </Panel>

      {/* Form */}
      <Panel>
        <form onSubmit={handleSubmit} className="mr-form" data-testid="create-mr-form">
          <div className="form-group">
            <Select
              id="sourceBranch"
              label="Source Branch *"
              value={sourceBranchId}
              options={activeBranches
                .filter((branch) => !branch.isMain)
                .map((branch) => ({ label: branch.name, value: branch.id }))}
              onOptionSelect={(option) => setSourceBranchId(option.value)}
              disabled={branchesLoading}
              data-testid="source-branch-select"
            />
            <p className="form-help">The branch containing changes you want to merge</p>
          </div>

          <div className="form-group">
            <Select
              id="targetBranch"
              label="Target Branch *"
              value={targetBranchId}
              options={mainBranch ? [{ label: mainBranch.name, value: mainBranch.id }] : []}
              onOptionSelect={() => {}}
              disabled
              data-testid="target-branch-select"
            />
            <p className="form-help">All merge requests target the main branch</p>
          </div>

          <div className="form-group">
            <TextInput
              id="title"
              label="Title *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a descriptive title..."
              data-testid="title-input"
            />
          </div>

          <div className="form-group">
            <Textarea
              id="description"
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the changes in this merge request..."
              rows={4}
              data-testid="description-input"
            />
          </div>

          {(validationError || createError) && (
            <InlineMessage type="critical" title={validationError || createError || ''} data-testid="form-error" />
          )}

          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={handleCancel}
              disabled={isCreating}
              label="Cancel"
              data-testid="cancel-btn"
            />
            <Button
              variant="primary"
              buttonType="submit"
              onClick={() => {}}
              disabled={isCreating}
              isLoading={isCreating}
              label={isCreating ? 'Creating...' : 'Create Merge Request'}
              data-testid="submit-btn"
            />
          </div>
        </form>
      </Panel>
    </div>
  );
}
