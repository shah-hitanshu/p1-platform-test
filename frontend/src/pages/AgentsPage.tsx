/**
 * Agents Page
 *
 * Admin page for managing registered agents and their API keys.
 */

import { Fragment, useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  listAgents,
  registerAgent as registerAgentApi,
  updateAgentStatus as updateAgentStatusApi,
  deleteAgent as deleteAgentApi,
  listAgentKeys,
  generateAgentKey as generateAgentKeyApi,
  revokeAgentKey as revokeAgentKeyApi,
} from '../api/agents';
import type { RegisterAgentParams } from '../api/agents';
import { ApiResponse } from '../components/ApiResponse';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import type { RegisteredAgent, AgentApiKey } from '../types';
import {
  Button,
  Alert,
} from '@pantheon-systems/design-toolkit-react';
import './AgentsPage.css';

export function AgentsPage() {
  const { data: agents, isLoading, error, execute: fetchAgents } = useApi<RegisteredAgent[], []>(listAgents);
  const { execute: registerAgentRequest, isLoading: isRegistering, error: registerError } = useApi<RegisteredAgent, [RegisterAgentParams]>(registerAgentApi);
  const { execute: updateStatusRequest } = useApi<RegisteredAgent, [string, 'active' | 'suspended' | 'disabled']>(updateAgentStatusApi);
  const { execute: deleteAgentRequest, isLoading: isDeleting, error: deleteError } = useApi<void, [string]>(deleteAgentApi);

  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [agentToDelete, setAgentToDelete] = useState<RegisteredAgent | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentKeys, setAgentKeys] = useState<Record<string, AgentApiKey[]>>({});
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const result = await registerAgentRequest({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
    });
    if (result) {
      setNewName('');
      setNewDescription('');
      setShowRegisterForm(false);
      fetchAgents();
    }
  };

  const handleStatusChange = async (agent: RegisteredAgent, status: 'active' | 'suspended' | 'disabled') => {
    const result = await updateStatusRequest(agent.id, status);
    if (result) {
      fetchAgents();
    }
  };

  const handleDeleteAgent = async () => {
    if (!agentToDelete) return;

    const result = await deleteAgentRequest(agentToDelete.id);
    if (result !== null) {
      setAgentToDelete(null);
      fetchAgents();
    }
  };

  const handleExpandKeys = async (agentId: string) => {
    if (expandedAgentId === agentId) {
      setExpandedAgentId(null);
      setNewKeyValue(null);
      return;
    }

    setExpandedAgentId(agentId);
    setNewKeyValue(null);

    try {
      const keys = await listAgentKeys(agentId);
      setAgentKeys((prev) => ({ ...prev, [agentId]: keys }));
    } catch {
      // Keys fetch failed silently
    }
  };

  const handleGenerateKey = async (agentId: string) => {
    try {
      const result = await generateAgentKeyApi(agentId);
      if (result) {
        const rawKey = (result as unknown as Record<string, unknown>).token as string | undefined
          ?? (result as unknown as Record<string, unknown>).key as string | undefined
          ?? null;
        setNewKeyValue(rawKey);

        // Refresh keys list
        const keys = await listAgentKeys(agentId);
        setAgentKeys((prev) => ({ ...prev, [agentId]: keys }));
      }
    } catch {
      // Key generation failed silently
    }
  };

  const handleRevokeKey = async (agentId: string, keyId: string) => {
    try {
      await revokeAgentKeyApi(agentId, keyId);

      // Refresh keys list
      const keys = await listAgentKeys(agentId);
      setAgentKeys((prev) => ({ ...prev, [agentId]: keys }));
    } catch {
      // Key revocation failed silently
    }
  };

  return (
    <div className="agents-page">
      <header className="page-header">
        <div className="header-content">
          <h1 className="page-title" data-testid="page-title">Agents</h1>
          <p className="page-subtitle" data-testid="page-subtitle">Manage registered agents and API keys</p>
        </div>
        <Button
          type={showRegisterForm ? 'secondary' : 'primary'}
          onClick={() => setShowRegisterForm(!showRegisterForm)}
          data-testid="register-agent-btn"
        >
          {showRegisterForm ? 'Cancel' : '+ Register agent'}
        </Button>
      </header>

      {showRegisterForm && (
        <div className="create-form-container" data-testid="register-agent-form">
          <form onSubmit={handleRegisterAgent} className="create-form">
            <div className="form-fields">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Agent name..."
                className="pds-input"
                autoFocus
                required
                aria-label="Agent name"
                data-testid="agent-name-input"
              />
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description (optional)..."
                className="pds-input"
                aria-label="Description"
                data-testid="agent-description-input"
              />
            </div>
            <Button
              type="primary"
              isSubmit
              onClick={() => {}}
              disabled={isRegistering || !newName.trim()}
              isLoading={isRegistering}
              data-testid="submit-agent-btn"
            >
              {isRegistering ? 'Registering...' : 'Register'}
            </Button>
          </form>
          {registerError && (
            <Alert type="danger" className="create-error-alert" data-testid="register-error">
              {registerError}
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
      ) : agents && agents.length > 0 ? (
        <div className="agents-table-container">
          <table className="agents-table" data-testid="agents-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Status</th>
                <th>Keys</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent: RegisteredAgent) => (
                <Fragment key={agent.id}>
                  <tr key={agent.id} data-testid={`agent-row-${agent.id}`}>
                    <td className="agent-name">{agent.name}</td>
                    <td className="agent-description">
                      {agent.description || <span className="no-value">-</span>}
                    </td>
                    <td>
                      <select
                        value={agent.status}
                        onChange={(e) => handleStatusChange(agent, e.target.value as 'active' | 'suspended' | 'disabled')}
                        className="pds-select status-select"
                        aria-label={`Status for ${agent.name}`}
                        data-testid={`status-select-${agent.id}`}
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td>
                      <Button
                        type="secondary"
                        onClick={() => handleExpandKeys(agent.id)}
                        data-testid={`expand-keys-${agent.id}`}
                      >
                        {expandedAgentId === agent.id ? 'Hide keys' : 'Show keys'}
                      </Button>
                    </td>
                    <td className="agent-actions">
                      <Button
                        type="danger"
                        onClick={() => setAgentToDelete(agent)}
                        data-testid={`delete-agent-${agent.id}`}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                  {expandedAgentId === agent.id && (
                    <tr key={`${agent.id}-keys`}>
                      <td colSpan={5}>
                        <div className="keys-section">
                          <div className="keys-header">
                            <h4>API Keys</h4>
                            <Button
                              type="primary"
                              onClick={() => handleGenerateKey(agent.id)}
                              data-testid={`generate-key-btn-${agent.id}`}
                            >
                              Generate key
                            </Button>
                          </div>

                          {newKeyValue && (
                            <Alert type="warning" className="new-key-alert" data-testid="new-key-alert">
                              <strong>Copy this key now.</strong> It will not be shown again.
                              <div className="new-key-value">{newKeyValue}</div>
                            </Alert>
                          )}

                          {agentKeys[agent.id] && agentKeys[agent.id].length > 0 ? (
                            <table className="keys-table">
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Prefix</th>
                                  <th>Created</th>
                                  <th>Last used</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {agentKeys[agent.id].map((apiKey: AgentApiKey) => (
                                  <tr key={apiKey.id} data-testid={`key-row-${apiKey.id}`}>
                                    <td>{apiKey.name}</td>
                                    <td className="key-prefix">{apiKey.prefix}</td>
                                    <td>{new Date(apiKey.createdAt).toLocaleDateString()}</td>
                                    <td>{apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleDateString() : 'Never'}</td>
                                    <td>
                                      <Button
                                        type="danger"
                                        onClick={() => handleRevokeKey(agent.id, apiKey.id)}
                                        data-testid={`revoke-key-${apiKey.id}`}
                                      >
                                        Revoke
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="empty-keys">No API keys. Generate one to get started.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state" data-testid="empty-state">
          <p>No agents registered. Register an agent to enable API access for automated systems.</p>
          <p className="empty-state-hint">Agents can be granted site-level roles for scoped access.</p>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={agentToDelete !== null}
        resourceType="agent"
        resourceName={agentToDelete?.name ?? ''}
        onConfirm={handleDeleteAgent}
        onCancel={() => setAgentToDelete(null)}
        isDeleting={isDeleting}
        error={deleteError}
      />
    </div>
  );
}
