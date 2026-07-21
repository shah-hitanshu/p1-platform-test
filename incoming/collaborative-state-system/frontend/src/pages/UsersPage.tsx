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
  CompactEmptyState,
  InlineMessage,
  MenuButton,
  Panel,
  Select,
  StatusBadge,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
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

  return (
    <div className="users-page">
      <Panel data-testid="page-header">
        <div className="header-content">
          <h1 className="page-title" data-testid="page-title">Users</h1>
          <p className="page-subtitle" data-testid="page-subtitle">Manage system access allowlist</p>
        </div>
        <Button
          variant={showAddForm ? 'secondary' : 'primary'}
          onClick={() => setShowAddForm(!showAddForm)}
          label={showAddForm ? 'Cancel' : '+ Add user'}
          data-testid="add-user-btn"
        />
      </Panel>

      {showAddForm && (
        <div className="create-form-container" data-testid="add-user-form">
          <form onSubmit={handleAddUser} className="create-form">
            <div className="form-fields">
              <TextInput
                id="user-email"
                label="Email address"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoFocus
                required
                data-testid="user-email-input"
              />
              <TextInput
                id="user-name"
                label="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                data-testid="user-name-input"
              />
              <Select
                id="user-role-select"
                label="System role"
                value={newRole}
                options={[
                  { label: 'Member', value: 'member' },
                  { label: 'Admin', value: 'admin' },
                ]}
                onOptionSelect={(option) => setNewRole(option.value as 'admin' | 'member')}
                data-testid="user-role-select"
              />
            </div>
            <Button
              variant="primary"
              buttonType="submit"
              onClick={() => {}}
              disabled={isAdding || !newEmail.trim()}
              isLoading={isAdding}
              label={isAdding ? 'Adding...' : 'Add'}
              data-testid="submit-user-btn"
            />
          </form>
          {addError && (
            <InlineMessage type="critical" title={addError} className="create-error-alert" data-testid="add-error" />
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
          <table data-testid="users-table">
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
                    <MenuButton
                      id={`role-menu-${user.id}`}
                      label={user.systemRole}
                      variant="secondary"
                      size="sm"
                      testId={`role-select-${user.id}`}
                      menuItems={[
                        { label: 'Member', callback: () => handleChangeRole(user, 'member') },
                        { label: 'Admin', callback: () => handleChangeRole(user, 'admin') },
                      ]}
                    />
                  </td>
                  <td>
                    <StatusBadge label={user.isActive ? 'active' : 'inactive'} color="neutral" data-testid={`status-${user.id}`} />
                  </td>
                  <td className="user-login-status">
                    {user.principalId ? (
                      <StatusBadge label="Yes" color="neutral" />
                    ) : (
                      <StatusBadge label="Pending" color="neutral" />
                    )}
                  </td>
                  <td className="user-actions">
                    <Button
                      variant="secondary"
                      onClick={() => handleToggleActive(user)}
                      label={user.isActive ? 'Deactivate' : 'Activate'}
                      data-testid={`toggle-active-${user.id}`}
                    />
                    <Button
                      variant="critical"
                      onClick={() => setUserToRemove(user)}
                      label="Remove"
                      data-testid={`remove-user-${user.id}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      ) : (
        <CompactEmptyState
          data-testid="empty-state"
          iconName="user"
          heading="No users found"
          message="Add a user to activate the allowlist."
        />
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
