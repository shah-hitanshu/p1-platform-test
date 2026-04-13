/**
 * Mock Login Form
 *
 * Extracted from LoginPage — provides mock user selection for
 * local development without OAuth credentials.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  Button,
  InlineMessage,
  Select,
  StatusBadge,
} from '@pantheon-systems/pds-toolkit-react';

const MOCK_USERS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer', email: 'alice@example.com', role: 'admin' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bob Teammate', email: 'bob@example.com', role: 'team_member' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Carol Coder', email: 'carol@example.com', role: 'developer' },
];

export function MockLoginForm() {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { loginWithMock } = useAuth();
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
      await loginWithMock(selectedUserId);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn\'t log you in. Try again or select a different user.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedUser = MOCK_USERS.find((u) => u.id === selectedUserId);

  return (
    <form onSubmit={handleLogin} className="login-form" data-testid="mock-login-form">
      <div>
        <Select
          id="user-select"
          label="Select user"
          value={selectedUserId}
          options={MOCK_USERS.map((u) => ({ label: `${u.name} (${u.email})`, value: u.id }))}
          onOptionSelect={(option) => setSelectedUserId(option.value)}
          disabled={isLoading}
          data-testid="user-select"
        />
      </div>

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
            <StatusBadge label={selectedUser.role} color="neutral" data-testid="preview-role" />
          </div>
        </div>
      )}

      {error && (
        <InlineMessage type="critical" title={error} data-testid="login-error" />
      )}

      <Button
        variant="primary"
        buttonType="submit"
        label={isLoading ? 'Logging in...' : 'Log in'}
        onClick={() => {}}
        disabled={isLoading || !selectedUserId}
        isLoading={isLoading}
        data-testid="login-button"
      />
    </form>
  );
}
