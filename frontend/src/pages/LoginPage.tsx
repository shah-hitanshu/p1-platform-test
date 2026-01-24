/**
 * Login Page
 *
 * Mock login page for selecting a user or agent to authenticate as.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './LoginPage.css';

// User IDs must be valid UUIDs to match database schema for created_by_id columns
const MOCK_USERS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer', email: 'alice@example.com', role: 'admin' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bob Teammate', email: 'bob@example.com', role: 'team_member' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Carol Coder', email: 'carol@example.com', role: 'developer' },
];

export function LoginPage() {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      setError('Please select a user');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await login(selectedUserId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedUser = MOCK_USERS.find((u) => u.id === selectedUserId);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title">CSS Explorer</h1>
          <p className="login-subtitle">Collaborative State System API Explorer</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="user-select" className="form-label">
              Select User
            </label>
            <select
              id="user-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="form-select"
              disabled={isLoading}
            >
              <option value="">Choose a user...</option>
              {MOCK_USERS.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </div>

          {selectedUser && (
            <div className="user-preview">
              <div className="preview-row">
                <span className="preview-label">Name:</span>
                <span className="preview-value">{selectedUser.name}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Email:</span>
                <span className="preview-value">{selectedUser.email}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Role:</span>
                <span className="preview-value role-badge">{selectedUser.role}</span>
              </div>
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-button" disabled={isLoading || !selectedUserId}>
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="login-footer">
          <p>This is a development environment with mock authentication.</p>
        </div>
      </div>
    </div>
  );
}
