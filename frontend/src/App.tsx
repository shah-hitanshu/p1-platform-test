/**
 * App Component
 *
 * Main router configuration for Pantheon P1.
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner } from '@pantheon-systems/pds-toolkit-react';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SitesPage } from './pages/SitesPage';
import { SiteDetailPage } from './pages/SiteDetailPage';
import { BranchDetailPage } from './pages/BranchDetailPage';
import { DocumentPage } from './pages/DocumentPage';
import { MergeRequestsPage } from './pages/MergeRequestsPage';
import { CreateMergeRequestPage } from './pages/CreateMergeRequestPage';
import { MergeRequestDetailPage } from './pages/MergeRequestDetailPage';
import { UsersPage } from './pages/UsersPage';
import { AgentsPage } from './pages/AgentsPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <Spinner label="Loading" showLabel size="4xl" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <Spinner label="Loading" showLabel size="4xl" />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      {/* Protected routes with layout */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/sites/:siteId" element={<SiteDetailPage />} />
        <Route path="/sites/:siteId/merge-requests" element={<MergeRequestsPage />} />
        <Route path="/sites/:siteId/merge-requests/new" element={<CreateMergeRequestPage />} />
        <Route path="/sites/:siteId/merge-requests/:requestId" element={<MergeRequestDetailPage />} />
        <Route path="/sites/:siteId/branches/:branchId" element={<BranchDetailPage />} />
        <Route path="/sites/:siteId/branches/:branchId/documents/:documentId" element={<DocumentPage />} />
        <Route path="/sites/:siteId/documents/:documentId" element={<DocumentPage />} />
      </Route>

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
