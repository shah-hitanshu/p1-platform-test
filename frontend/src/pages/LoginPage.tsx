/**
 * Login Page
 *
 * Mock login page for selecting a user or agent to authenticate as.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  Button,
  Alert,
  FormGroup,
  Tag,
} from '@pantheon-systems/design-toolkit-react';
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
      setError('Select a user to continue.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await login(selectedUserId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn\'t log you in. Try again or select a different user.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedUser = MOCK_USERS.find((u) => u.id === selectedUserId);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title" data-testid="login-title">CSS Explorer</h1>
          <p className="login-subtitle">Collaborative State System API Explorer</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <FormGroup>
            <label htmlFor="user-select" className="form-label">
              Select user
            </label>
            <select
              id="user-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="pds-select"
              disabled={isLoading}
              aria-label="Select user"
              data-testid="user-select"
            >
              <option value="">Choose a user...</option>
              {MOCK_USERS.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </FormGroup>

          {selectedUser && (
            <div className="user-preview" data-testid="user-preview">
              <div className="preview-row">
                <span className="preview-label">Name:</span>
                <span className="preview-value" data-testid="preview-name">{selectedUser.name}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Email:</span>
                <span className="preview-value" data-testid="preview-email">{selectedUser.email}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Role:</span>
                <Tag type="info" data-testid="preview-role">{selectedUser.role}</Tag>
              </div>
            </div>
          )}

          {error && (
            <Alert type="danger" data-testid="login-error">
              {error}
            </Alert>
          )}

          <Button
            type="primary"
            isSubmit
            onClick={() => {}}
            disabled={isLoading || !selectedUserId}
            isLoading={isLoading}
            data-testid="login-button"
          >
            {isLoading ? 'Logging in...' : 'Log in'}
          </Button>
        </form>

        <div className="login-footer">
          <p>This is a development environment with mock authentication.</p>
        </div>
      </div>
    </div>
  );
}
