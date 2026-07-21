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
import { SiteScreenshot } from '../components/SiteScreenshot';
import type { Site } from '../types';
import { isValidUrl } from '../utils/url';
import {
  Button,
  CompactEmptyState,
  InlineMessage,
  Panel,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
import './SitesPage.css';

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = then - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return RELATIVE_TIME_FORMAT.format(diffSec, 'second');
  if (absSec < 3600) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86400) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 3600), 'hour');
  if (absSec < 2592000) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 86400), 'day');
  if (absSec < 31536000) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 2592000), 'month');
  return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 31536000), 'year');
}

export function SitesPage() {
  const { data: sites, isLoading, error, execute: fetchSites } = useApi<Site[], []>(listSites);
  const { execute: createSiteRequest, isLoading: isCreating, error: createError } = useApi<Site, [CreateSiteParams]>(createSiteApi);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newPantheonSiteId, setNewPantheonSiteId] = useState('');
  const [newSiteUrl, setNewSiteUrl] = useState('');
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName.trim() || !newPantheonSiteId.trim()) return;

    const trimmedUrl = newSiteUrl.trim();
    if (!isValidUrl(trimmedUrl)) {
      setUrlValidationError('Enter a valid URL (e.g. https://example.com).');
      return;
    }
    setUrlValidationError(null);

    const result = await createSiteRequest({
      name: newSiteName.trim(),
      pantheonSiteId: newPantheonSiteId.trim(),
      ...(trimmedUrl !== '' ? { url: trimmedUrl } : {}),
    });
    if (result) {
      setNewSiteName('');
      setNewPantheonSiteId('');
      setNewSiteUrl('');
      setShowCreateForm(false);
      fetchSites();
    }
  };

  return (
    <div className="sites-page">
      <Panel data-testid="page-header">
        <div className="header-content">
          <h1 className="page-title" data-testid="page-title">Sites</h1>
          <p className="page-subtitle" data-testid="page-subtitle">Manage your collaborative sites</p>
        </div>
        <Button
          variant={showCreateForm ? 'secondary' : 'primary'}
          onClick={() => setShowCreateForm(!showCreateForm)}
          label={showCreateForm ? 'Cancel' : '+ Create new site'}
          data-testid="create-site-btn"
        />
      </Panel>

      {showCreateForm && (
        <div className="create-form-container" data-testid="create-form">
          <form onSubmit={handleCreateSite} className="create-form">
            <div className="form-fields">
              <TextInput
                id="site-name"
                label="Site name"
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                placeholder="Enter site name..."
                autoFocus
                data-testid="site-name-input"
              />
              <TextInput
                id="pantheon-site-id"
                label="Pantheon Site ID"
                value={newPantheonSiteId}
                onChange={(e) => setNewPantheonSiteId(e.target.value)}
                placeholder="Enter Pantheon Site ID..."
                data-testid="pantheon-id-input"
              />
              <TextInput
                id="site-url"
                label="Site URL (optional)"
                value={newSiteUrl}
                onChange={(e) => {
                  setNewSiteUrl(e.target.value);
                  if (urlValidationError !== null) setUrlValidationError(null);
                }}
                placeholder="https://example.pantheonsite.io"
                data-testid="site-url-input"
              />
            </div>
            <Button
              variant="primary"
              buttonType="submit"
              onClick={() => {}}
              disabled={isCreating || !newSiteName.trim() || !newPantheonSiteId.trim()}
              isLoading={isCreating}
              label={isCreating ? 'Creating...' : 'Create'}
              data-testid="submit-site-btn"
            />
          </form>
          {urlValidationError && (
            <InlineMessage type="critical" title={urlValidationError} className="create-error-alert" data-testid="url-validation-error" />
          )}
          {createError && (
            <InlineMessage type="critical" title={createError} className="create-error-alert" data-testid="create-error" />
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
        <div className="sites-grid" data-testid="sites-grid">
          {sites.map((site: Site) => (
            <article key={site.id} className="site-card" data-testid={`site-row-${site.id}`}>
              <SiteScreenshot siteId={site.id} size="thumbnail" alt={`${site.name} screenshot`} />
              <div className="site-card__body">
                <h2 className="site-card__name" data-testid={`site-name-${site.id}`}>{site.name}</h2>
                <p className="site-card__meta">Updated {formatRelativeTime(site.updatedAt)}</p>
                <div className="site-card__actions">
                  <Link
                    to={`/sites/${site.id}`}
                    className="site-card__overview"
                    data-testid={`view-site-${site.id}`}
                  >
                    Site overview
                  </Link>
                  <Link
                    to={`/sites/${site.id}`}
                    className="site-card__editor"
                    data-testid={`editor-site-${site.id}`}
                  >
                    Editor
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <CompactEmptyState
          data-testid="empty-state"
          heading="No sites found. Create your first site to get started."
        />
      )}
    </div>
  );
}
