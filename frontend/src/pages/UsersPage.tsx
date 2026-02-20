/**
 * Users Page
 *
 * Admin page for managing system-level user allowlist.
 */

import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  listUsers,
  addUser as addUserApi,
  updateUser as updateUserApi,
  removeUser as removeUserApi,
} from '../api/users';
import type { AddUserParams } from '../api/users';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { SystemUser } from '../types';
import {
  Button,
  Alert,
  Tag,
} from '@pantheon-systems/design-toolkit-react';
import './UsersPage.css';

export function UsersPage() {
  const { data: users, isLoading, error, execute: fetchUsers } = useApi<SystemUser[], []>(listUsers);
  const { execute: addUserRequest, isLoading: isAdding, error: addError } = useApi<SystemUser, [AddUserParams]>(addUserApi);
  const { execute: updateUserRequest } = useApi<SystemUser, [string, { name?: string; systemRole?: 'admin' | 'member'; isActive?: boolean }]>(updateUserApi);
  const { execute: removeUserRequest, isLoading: isRemoving, error: removeError } = useApi<void, [string]>(removeUserApi);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [userToRemove, setUserToRemove] = useState<SystemUser | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    const result = await addUserRequest({
      email: newEmail.trim(),
      name: newName.trim() || undefined,
      systemRole: newRole,
    });
    if (result) {
      setNewEmail('');
      setNewName('');
      setNewRole('member');
      setShowAddForm(false);
      fetchUsers();
    }
  };

  const handleToggleActive = async (user: SystemUser) => {
    const result = await updateUserRequest(user.id, { isActive: !user.isActive });
    if (result) {
      fetchUsers();
    }
  };

  const handleChangeRole = async (user: SystemUser, role: 'admin' | 'member') => {
    const result = await updateUserRequest(user.id, { systemRole: role });
    if (result) {
      fetchUsers();
    }
  };

  const handleRemoveUser = async () => {
    if (!userToRemove) return;

    const result = await removeUserRequest(userToRemove.id);
    if (result !== null) {
      setUserToRemove(null);
      fetchUsers();
    }
  };

  const getStatusTagType = (isActive: boolean): 'success' | 'danger' => {
    return isActive ? 'success' : 'danger';
  };

  return (
    <div className="users-page">
      <header className="page-header">
        <div className="header-content">
          <h1 className="page-title" data-testid="page-title">Users</h1>
          <p className="page-subtitle" data-testid="page-subtitle">Manage system access allowlist</p>
        </div>
        <Button
          type={showAddForm ? 'secondary' : 'primary'}
          onClick={() => setShowAddForm(!showAddForm)}
          data-testid="add-user-btn"
        >
          {showAddForm ? 'Cancel' : '+ Add user'}
        </Button>
      </header>

      {showAddForm && (
        <div className="create-form-container" data-testid="add-user-form">
          <form onSubmit={handleAddUser} className="create-form">
            <div className="form-fields">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email address..."
                className="pds-input"
                autoFocus
                required
                aria-label="Email address"
                data-testid="user-email-input"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (optional)..."
                className="pds-input"
                aria-label="Name"
                data-testid="user-name-input"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}
                className="pds-select"
                aria-label="System role"
                data-testid="user-role-select"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button
              type="primary"
              isSubmit
              onClick={() => {}}
              disabled={isAdding || !newEmail.trim()}
              isLoading={isAdding}
              data-testid="submit-user-btn"
            >
              {isAdding ? 'Adding...' : 'Add'}
            </Button>
          </form>
          {addError && (
            <Alert type="danger" className="create-error-alert" data-testid="add-error">
              {addError}
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
      ) : users && users.length > 0 ? (
        <div className="users-table-container">
          <table className="users-table" data-testid="users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Logged in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user: SystemUser) => (
                <tr key={user.id} data-testid={`user-row-${user.id}`}>
                  <td className="user-email">{user.email}</td>
                  <td className="user-name-cell">{user.name || <span className="no-value">-</span>}</td>
                  <td>
                    <select
                      value={user.systemRole}
                      onChange={(e) => handleChangeRole(user, e.target.value as 'admin' | 'member')}
                      className="pds-select role-select"
                      aria-label={`Role for ${user.email}`}
                      data-testid={`role-select-${user.id}`}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <Tag type={getStatusTagType(user.isActive)} data-testid={`status-${user.id}`}>
                      {user.isActive ? 'active' : 'inactive'}
                    </Tag>
                  </td>
                  <td className="user-login-status">
                    {user.principalId ? (
                      <Tag type="success">Yes</Tag>
                    ) : (
                      <Tag type="default">Pending</Tag>
                    )}
                  </td>
                  <td className="user-actions">
                    <Button
                      type="secondary"
                      onClick={() => handleToggleActive(user)}
                      data-testid={`toggle-active-${user.id}`}
                    >
                      {user.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      type="danger"
                      onClick={() => setUserToRemove(user)}
                      data-testid={`remove-user-${user.id}`}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state" data-testid="empty-state">
          <p>No users in the allowlist. The system is currently open to all authenticated users.</p>
          <p className="empty-state-hint">Add a user to activate the allowlist.</p>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={userToRemove !== null}
        resourceType="user"
        resourceName={userToRemove?.email ?? ''}
        onConfirm={handleRemoveUser}
        onCancel={() => setUserToRemove(null)}
        isDeleting={isRemoving}
        error={removeError}
      />
    </div>
  );
}
