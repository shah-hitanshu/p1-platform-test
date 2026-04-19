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
  CompactEmptyState,
  InlineMessage,
  MenuButton,
  Panel,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
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
      <Panel data-testid="page-header">
        <div className="header-content">
          <h1 className="page-title" data-testid="page-title">Agents</h1>
          <p className="page-subtitle" data-testid="page-subtitle">Manage registered agents and API keys</p>
        </div>
        <Button
          variant={showRegisterForm ? 'secondary' : 'primary'}
          onClick={() => setShowRegisterForm(!showRegisterForm)}
          label={showRegisterForm ? 'Cancel' : '+ Register agent'}
          data-testid="register-agent-btn"
        />
      </Panel>

      {showRegisterForm && (
        <div className="create-form-container" data-testid="register-agent-form">
          <form onSubmit={handleRegisterAgent} className="create-form">
            <div className="form-fields">
              <TextInput
                id="agent-name"
                label="Agent name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
                data-testid="agent-name-input"
              />
              <TextInput
                id="agent-description"
                label="Description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                data-testid="agent-description-input"
              />
            </div>
            <Button
              variant="primary"
              buttonType="submit"
              onClick={() => {}}
              disabled={isRegistering || !newName.trim()}
              isLoading={isRegistering}
              label={isRegistering ? 'Registering...' : 'Register'}
              data-testid="submit-agent-btn"
            />
          </form>
          {registerError && (
            <InlineMessage type="critical" title={registerError} className="create-error-alert" data-testid="register-error" />
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
          <table data-testid="agents-table">
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
                      <MenuButton
                        id={`status-menu-${agent.id}`}
                        label={agent.status}
                        variant="secondary"
                        size="sm"
                        testId={`status-select-${agent.id}`}
                        menuItems={[
                          { label: 'Active', callback: () => handleStatusChange(agent, 'active') },
                          { label: 'Suspended', callback: () => handleStatusChange(agent, 'suspended') },
                          { label: 'Disabled', callback: () => handleStatusChange(agent, 'disabled') },
                        ]}
                      />
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => handleExpandKeys(agent.id)}
                        label={expandedAgentId === agent.id ? 'Hide keys' : 'Show keys'}
                        data-testid={`expand-keys-${agent.id}`}
                      />
                    </td>
                    <td className="agent-actions">
                      <Button
                        variant="critical"
                        onClick={() => setAgentToDelete(agent)}
                        label="Delete"
                        data-testid={`delete-agent-${agent.id}`}
                      />
                    </td>
                  </tr>
                  {expandedAgentId === agent.id && (
                    <tr key={`${agent.id}-keys`}>
                      <td colSpan={5}>
                        <div className="keys-section">
                          <div className="keys-header">
                            <h4>API Keys</h4>
                            <Button
                              variant="primary"
                              onClick={() => handleGenerateKey(agent.id)}
                              label="Generate key"
                              data-testid={`generate-key-btn-${agent.id}`}
                            />
                          </div>

                          {newKeyValue && (
                            <InlineMessage type="warning" title="Copy this key now. It will not be shown again." message={<div className="new-key-value">{newKeyValue}</div>} className="new-key-alert" data-testid="new-key-alert" />
                          )}

                          {agentKeys[agent.id] && agentKeys[agent.id].length > 0 ? (
                            <table>
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
                                        variant="critical"
                                        onClick={() => handleRevokeKey(agent.id, apiKey.id)}
                                        label="Revoke"
                                        data-testid={`revoke-key-${apiKey.id}`}
                                      />
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
      ) : (
        <CompactEmptyState
          data-testid="empty-state"
          iconName="robot"
          heading="No agents registered"
          message="Agents can be granted site-level roles for scoped access."
        />
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
