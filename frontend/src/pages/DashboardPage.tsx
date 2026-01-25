/**
 * Dashboard Page
 *
 * Overview page showing health status and quick actions.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { ApiResponse } from '../components/ApiResponse';
import { Button } from '@pantheon-systems/design-toolkit-react';
import './DashboardPage.css';

interface HealthResponse {
  status: string;
  timestamp: string;
  version?: string;
}

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/health');
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  return response.json();
}

export function DashboardPage() {
  const { data, isLoading, error, execute } = useApi(fetchHealth);

  useEffect(() => {
    execute();
  }, [execute]);

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">System overview and health status</p>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <div className="card-header">
            <h2 className="card-title">System Health</h2>
            <Button
              type="secondary"
              onClick={() => execute()}
              disabled={isLoading}
              isLoading={isLoading}
              data-testid="refresh-health-btn"
            >
              Refresh
            </Button>
          </div>
          <div className="card-content">
            <ApiResponse data={data} isLoading={isLoading} error={error} />
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h2 className="card-title">Quick Actions</h2>
          </div>
          <div className="card-content">
            <div className="quick-actions">
              <Link to="/sites" className="action-link" data-testid="create-site-action">
                <span className="action-icon">+</span>
                <span className="action-text">Create site</span>
              </Link>
              <Link to="/sites" className="action-link" data-testid="view-sites-action">
                <span className="action-icon">&rarr;</span>
                <span className="action-text">View sites</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="dashboard-card full-width">
          <div className="card-header">
            <h2 className="card-title">API Endpoints</h2>
          </div>
          <div className="card-content">
            <div className="endpoints-list">
              <div className="endpoint-item">
                <code className="endpoint-method get">GET</code>
                <code className="endpoint-path">/api/sites</code>
                <span className="endpoint-desc">List all sites</span>
              </div>
              <div className="endpoint-item">
                <code className="endpoint-method post">POST</code>
                <code className="endpoint-path">/api/sites</code>
                <span className="endpoint-desc">Create a new site</span>
              </div>
              <div className="endpoint-item">
                <code className="endpoint-method get">GET</code>
                <code className="endpoint-path">/api/sites/:siteId/branches</code>
                <span className="endpoint-desc">List branches for a site</span>
              </div>
              <div className="endpoint-item">
                <code className="endpoint-method get">GET</code>
                <code className="endpoint-path">/api/sites/:siteId/branches/:branchId/documents</code>
                <span className="endpoint-desc">List documents in a branch</span>
              </div>
              <div className="endpoint-item">
                <code className="endpoint-method get">GET</code>
                <code className="endpoint-path">/health</code>
                <span className="endpoint-desc">Health check</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
