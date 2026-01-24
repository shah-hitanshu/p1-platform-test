/**
 * Sites Page
 *
 * Lists all sites and allows creating new ones.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { listSites, createSite as createSiteApi } from '../api/sites';
import type { CreateSiteParams } from '../api/sites';
import { ApiResponse } from '../components/ApiResponse';
import type { Site } from '../types';
import './SitesPage.css';

export function SitesPage() {
  const { data: sites, isLoading, error, execute: fetchSites } = useApi<Site[], []>(listSites);
  const { execute: createSiteRequest, isLoading: isCreating } = useApi<Site, [CreateSiteParams]>(createSiteApi);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName.trim()) return;

    const result = await createSiteRequest({ name: newSiteName.trim() });
    if (result) {
      setNewSiteName('');
      setShowCreateForm(false);
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
          {showCreateForm ? 'Cancel' : '+ Create Site'}
        </button>
      </header>

      {showCreateForm && (
        <div className="create-form-container">
          <form onSubmit={handleCreateSite} className="create-form">
            <input
              type="text"
              value={newSiteName}
              onChange={(e) => setNewSiteName(e.target.value)}
              placeholder="Enter site name..."
              className="form-input"
              autoFocus
            />
            <button
              type="submit"
              className="submit-btn"
              disabled={isCreating || !newSiteName.trim()}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </form>
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
    </div>
  );
}
