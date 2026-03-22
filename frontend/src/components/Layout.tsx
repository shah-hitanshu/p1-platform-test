/**
 * Layout Component
 *
 * Main layout with navigation sidebar.
 */

import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@pantheon-systems/design-toolkit-react';
import './Layout.css';

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/sites', label: 'Sites' },
    { path: '/users', label: 'Users' },
    { path: '/agents', label: 'Agents' },
  ];

  return (
    <div className="layout">
      <nav className="sidebar" data-testid="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title" data-testid="sidebar-title">CSS Explorer</h1>
          <p className="sidebar-subtitle">API Testing Tool</p>
        </div>

        <ul className="nav-list">
          {navItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`nav-link ${
                  location.pathname === item.path ? 'active' : ''
                }`}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        {user && (
          <div className="user-panel">
            <div className="user-info">
              <span className="user-name" data-testid="user-name">{user.name}</span>
              <span className="user-email" data-testid="user-email">{user.email}</span>
            </div>
            <Button type="secondary" onClick={logout} data-testid="logout-button">
              Log out
            </Button>
          </div>
        )}
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
