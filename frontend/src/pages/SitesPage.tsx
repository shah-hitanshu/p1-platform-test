/**
 * Sites Page
 *
 * Lists all sites and allows creating new ones.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { listSites, createSite as createSiteApi, deleteSite as deleteSiteApi } from '../api/sites';
import type { CreateSiteParams } from '../api/sites';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { Site } from '../types';
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
        <button
          className="create-btn"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? 'Cancel' : '+ Create site'}
        </button>
      </header>

      {showCreateForm && (
        <div className="create-form-container">
          <form onSubmit={handleCreateSite} className="create-form">
            <div className="form-fields">
              <input
                type="text"
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                placeholder="Enter site name..."
                className="form-input"
                autoFocus
              />
              <input
                type="text"
                value={newPantheonSiteId}
                onChange={(e) => setNewPantheonSiteId(e.target.value)}
                placeholder="Enter Pantheon Site ID..."
                className="form-input"
              />
            </div>
            <button
              type="submit"
              className="submit-btn"
              disabled={isCreating || !newSiteName.trim() || !newPantheonSiteId.trim()}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </form>
          {createError && (
            <div className="create-error">
              <span className="error-icon">⚠</span>
              <span className="error-text">{createError}</span>
            </div>
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
          <table className="sites-table">
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
                <tr key={site.id}>
                  <td className="site-name">{site.name}</td>
                  <td className="site-id">
                    <code>{site.id}</code>
                  </td>
                  <td className="site-date">
                    {new Date(site.createdAt).toLocaleDateString()}
                  </td>
                  <td className="site-actions">
                    <Link to={`/sites/${site.id}`} className="view-link">
                      View
                    </Link>
                    <button
                      className="delete-link"
                      onClick={() => setSiteToDelete(site)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
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
