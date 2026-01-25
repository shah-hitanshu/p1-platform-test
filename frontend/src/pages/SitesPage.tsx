/**
 * Sites Page
 *
 * Lists all sites and allows creating new ones.
 */

import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { listSites, createSite as createSiteApi, deleteSite as deleteSiteApi } from '../api/sites';
import type { CreateSiteParams } from '../api/sites';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { Site } from '../types';
import {
  Button,
  RouterLinkButton,
  Alert,
} from '@pantheon-systems/design-toolkit-react';
import './SitesPage.css';

export function SitesPage() {
  const { data: sites, isLoading, error, execute: fetchSites } = useApi<Site[], []>(listSites);
  const { execute: createSiteRequest, isLoading: isCreating, error: createError } = useApi<Site, [CreateSiteParams]>(createSiteApi);
  const { execute: deleteSiteRequest, isLoading: isDeleting, error: deleteError } = useApi<void, [string]>(deleteSiteApi);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newPantheonSiteId, setNewPantheonSiteId] = useState('');
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName.trim() || !newPantheonSiteId.trim()) return;

    const result = await createSiteRequest({
      name: newSiteName.trim(),
      pantheonSiteId: newPantheonSiteId.trim()
    });
    if (result) {
      setNewSiteName('');
      setNewPantheonSiteId('');
      setShowCreateForm(false);
      fetchSites();
    }
  };

  const handleDeleteSite = async () => {
    if (!siteToDelete) return;

    const result = await deleteSiteRequest(siteToDelete.id);
    // Only close modal and refresh if deletion succeeded
    // For void functions: undefined = success, null = error
    if (result !== null) {
      setSiteToDelete(null);
      fetchSites();
    }
  };

  return (
    <div className="sites-page">
      <header className="page-header">
        <div className="header-content">
          <h1 className="page-title">Sites</h1>
          <p className="page-subtitle">Manage your collaborative sites</p>
        </div>
        <Button
          type={showCreateForm ? 'secondary' : 'primary'}
          onClick={() => setShowCreateForm(!showCreateForm)}
          data-testid="create-site-btn"
        >
          {showCreateForm ? 'Cancel' : '+ Create site'}
        </Button>
      </header>

      {showCreateForm && (
        <div className="create-form-container" data-testid="create-form">
          <form onSubmit={handleCreateSite} className="create-form">
            <div className="form-fields">
              <input
                type="text"
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                placeholder="Enter site name..."
                className="pds-input"
                autoFocus
                aria-label="Site name"
                data-testid="site-name-input"
              />
              <input
                type="text"
                value={newPantheonSiteId}
                onChange={(e) => setNewPantheonSiteId(e.target.value)}
                placeholder="Enter Pantheon Site ID..."
                className="pds-input"
                aria-label="Pantheon Site ID"
                data-testid="pantheon-id-input"
              />
            </div>
            <Button
              type="primary"
              isSubmit
              onClick={() => {}}
              disabled={isCreating || !newSiteName.trim() || !newPantheonSiteId.trim()}
              isLoading={isCreating}
              data-testid="submit-site-btn"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </form>
          {createError && (
            <Alert type="danger" className="create-error-alert" data-testid="create-error">
              {createError}
            </Alert>
          )}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <ApiResponse data={null} isLoading={false} error={error} />
        </div>
      )}

      {isLoading ? (
        <div className="loading-container">
          <ApiResponse data={null} isLoading={true} error={null} />
        </div>
      ) : sites && sites.length > 0 ? (
        <div className="sites-table-container">
          <table className="sites-table" data-testid="sites-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site: Site) => (
                <tr key={site.id} data-testid={`site-row-${site.id}`}>
                  <td className="site-name">{site.name}</td>
                  <td className="site-id">
                    <code>{site.id}</code>
                  </td>
                  <td className="site-date">
                    {new Date(site.createdAt).toLocaleDateString()}
                  </td>
                  <td className="site-actions">
                    <RouterLinkButton
                      to={`/sites/${site.id}`}
                      type="secondary"
                      data-testid={`view-site-${site.id}`}
                    >
                      View
                    </RouterLinkButton>
                    <Button
                      type="danger"
                      onClick={() => setSiteToDelete(site)}
                      data-testid={`delete-site-${site.id}`}
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
        <div className="empty-state" data-testid="empty-state">
          <p>No sites found. Create your first site to get started.</p>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={siteToDelete !== null}
        resourceType="site"
        resourceName={siteToDelete?.name ?? ''}
        onConfirm={handleDeleteSite}
        onCancel={() => setSiteToDelete(null)}
        isDeleting={isDeleting}
        error={deleteError}
      />
    </div>
  );
}
