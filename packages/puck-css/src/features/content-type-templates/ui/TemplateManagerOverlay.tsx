/**
 * TemplateManagerOverlay
 *
 * Full-screen overlay for managing content type templates.
 * Provides a list view of templates and a Puck-based editor for
 * creating and editing templates.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { P1Client } from '@pantheon-systems/css-client';
import type { Template } from '../types.js';
import { useTemplateList } from '../hooks/useTemplateList.js';
import { scaffoldFromTemplate } from '../editor/useTemplateScaffold.js';
import { TemplatePinPanel } from './TemplatePinPanel.js';
import { dataToCreateParams, dataToUpdateParams } from './dataToTemplate.js';
import type { TemplateMetadataInput } from './dataToTemplate.js';

export interface TemplateManagerOverlayProps {
  client: P1Client;
  siteId: string;
  branchId: string;
  puckConfig: unknown;
  onClose: () => void;
}

type EditorMode = 'list' | 'create' | 'edit';

interface PuckDataShape {
  content: Array<{ type: string; props: Record<string, unknown> }>;
  root: { props: Record<string, unknown> };
  zones?: Record<string, Array<{ type: string; props: Record<string, unknown> }>>;
}

export function TemplateManagerOverlay({
  client,
  siteId,
  branchId,
  puckConfig,
  onClose,
}: TemplateManagerOverlayProps): React.ReactElement {
  const { templates, loading, refresh } = useTemplateList(client, siteId, branchId);
  const [mode, setMode] = useState<EditorMode>('list');
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [editorData, setEditorData] = useState<PuckDataShape>({
    content: [],
    root: { props: {} },
  });
  const [pinMap, setPinMap] = useState<Map<string, boolean>>(new Map());
  const [metadata, setMetadata] = useState<TemplateMetadataInput>({
    name: '',
    label: '',
    description: '',
  });

  const handleCreate = useCallback(() => {
    setMode('create');
    setEditingTemplate(null);
    setEditorData({ content: [], root: { props: {} } });
    setPinMap(new Map());
    setMetadata({ name: '', label: '', description: '' });
    setError(null);
  }, []);

  const handleEdit = useCallback((template: Template) => {
    setMode('edit');
    setEditingTemplate(template);
    const data = scaffoldFromTemplate(template);
    setEditorData(data as unknown as PuckDataShape);
    const newPinMap = new Map<string, boolean>();
    (data as unknown as PuckDataShape).content.forEach((comp, idx) => {
      const compId = comp.props.id as string;
      newPinMap.set(compId, (template.components ?? [])[idx]?.pinned ?? false);
    });
    setPinMap(newPinMap);
    setMetadata({
      name: template.name,
      label: template.label,
      description: template.description ?? '',
      defaultUrlPattern: template.defaultUrlPattern ?? '',
    });
    setError(null);
  }, []);

  const handleDelete = useCallback(async (templateId: string) => {
    if (!window.confirm('Delete this template? Documents using it will not be affected.')) return;
    try {
      await client.templates.delete(siteId, branchId, templateId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  }, [client, siteId, branchId, refresh]);

  const handleSave = useCallback(async () => {
    if (!metadata.name.trim() || !metadata.label.trim()) {
      setError('Name and label are required');
      return;
    }
    const pattern = metadata.defaultUrlPattern?.trim() ?? '';
    if (pattern && !pattern.startsWith('/')) {
      setError('URL pattern must start with /');
      return;
    }
    if (pattern && /[?#]/.test(pattern)) {
      setError('URL pattern must not contain ? or #');
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'create') {
        const params = dataToCreateParams(editorData, pinMap, metadata);
        await client.templates.create(siteId, branchId, params);
      } else if (editingTemplate) {
        const params = dataToUpdateParams(editorData, pinMap, metadata);
        await client.templates.update(siteId, branchId, editingTemplate.id, params);
      }
      await refresh();
      setMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }, [mode, editingTemplate, editorData, pinMap, metadata, client, siteId, branchId, refresh]);

  const handleCancel = useCallback(() => {
    setMode('list');
    setEditingTemplate(null);
    setError(null);
  }, []);

  const handleTogglePin = useCallback((componentId: string, pinned: boolean) => {
    setPinMap((prev) => {
      const next = new Map(prev);
      next.set(componentId, pinned);
      return next;
    });
  }, []);

  const handlePuckChange = useCallback((data: unknown) => {
    const d = data as PuckDataShape;
    setEditorData(d);
    // Preserve pin state for existing components, default new ones to unpinned
    setPinMap((prev) => {
      const next = new Map<string, boolean>();
      for (const comp of d.content) {
        const id = comp.props.id as string;
        next.set(id, prev.get(id) ?? false);
      }
      return next;
    });
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mode === 'list') onClose();
        else handleCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, onClose, handleCancel]);

  const components = editorData.content.map((c) => ({
    id: c.props.id as string,
    type: c.type,
  }));

  const overlay = (
    <div className="template-manager-overlay" role="dialog" aria-label="Template Manager">
      <div className="template-manager-overlay__header">
        <h2 className="template-manager-overlay__title">
          {mode === 'list' ? 'Manage Templates' : mode === 'create' ? 'New Template' : `Edit: ${editingTemplate?.label}`}
        </h2>
        <button
          type="button"
          className="template-manager-overlay__close"
          onClick={mode === 'list' ? onClose : handleCancel}
          aria-label="Close template manager"
        >
          {mode === 'list' ? '×' : '← Back'}
        </button>
      </div>

      {error && (
        <div role="alert" className="template-manager-overlay__error">{error}</div>
      )}

      {mode === 'list' ? (
        <div className="template-manager-overlay__list">
          <button
            type="button"
            className="pds-button pds-button--primary"
            onClick={handleCreate}
          >
            + New Template
          </button>

          {loading ? (
            <div className="template-manager-overlay__loading">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="template-manager-overlay__empty">
              No templates yet. Create one to get started.
            </div>
          ) : (
            <ul className="template-manager-overlay__template-list">
              {templates.map((t) => (
                <li key={t.id} className="template-manager-overlay__template-item">
                  <div className="template-manager-overlay__template-info">
                    <span className="template-manager-overlay__template-label">{t.label || t.name}</span>
                    <span className="template-manager-overlay__template-meta">
                      {(t.components ?? []).length} component{(t.components ?? []).length !== 1 ? 's' : ''} · v{t.version}
                    </span>
                  </div>
                  <div className="template-manager-overlay__template-actions">
                    <button
                      type="button"
                      className="pds-button pds-button--secondary pds-button--sm"
                      onClick={() => handleEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="pds-button pds-button--critical-secondary pds-button--sm"
                      onClick={() => handleDelete(t.id)}
                      aria-label={`Delete ${t.label}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="template-manager-overlay__editor">
          <div className="template-manager-overlay__editor-sidebar">
            <div className="template-manager-overlay__metadata">
              <label className="template-manager-overlay__field">
                <span className="template-manager-overlay__field-label">Name</span>
                <input
                  type="text"
                  value={metadata.name}
                  onChange={(e) => setMetadata((m) => ({ ...m, name: e.target.value }))}
                  placeholder="blog-post"
                  disabled={mode === 'edit'}
                  className="template-manager-overlay__input"
                />
              </label>
              <label className="template-manager-overlay__field">
                <span className="template-manager-overlay__field-label">Label</span>
                <input
                  type="text"
                  value={metadata.label}
                  onChange={(e) => setMetadata((m) => ({ ...m, label: e.target.value }))}
                  placeholder="Blog Post"
                  className="template-manager-overlay__input"
                />
              </label>
              <label className="template-manager-overlay__field">
                <span className="template-manager-overlay__field-label">Description</span>
                <textarea
                  value={metadata.description}
                  onChange={(e) => setMetadata((m) => ({ ...m, description: e.target.value }))}
                  placeholder="Optional description"
                  rows={2}
                  className="template-manager-overlay__textarea"
                />
              </label>
              <label className="template-manager-overlay__field">
                <span className="template-manager-overlay__field-label">Default URL pattern</span>
                <input
                  type="text"
                  value={metadata.defaultUrlPattern ?? ''}
                  onChange={(e) => setMetadata((m) => ({ ...m, defaultUrlPattern: e.target.value }))}
                  placeholder="/blog/:year/:month/:slug"
                  className="template-manager-overlay__input"
                />
              </label>
            </div>

            <TemplatePinPanel
              components={components}
              pinMap={pinMap}
              onTogglePin={handleTogglePin}
            />

            <div className="template-manager-overlay__save-actions">
              <button
                type="button"
                className="pds-button pds-button--primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : mode === 'create' ? 'Create Template' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="pds-button pds-button--secondary"
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="template-manager-overlay__editor-canvas">
            <PuckEditor
              config={puckConfig}
              data={editorData}
              onChange={handlePuckChange}
            />
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

/**
 * Wrapper that lazily loads and renders Puck for template editing.
 */
function PuckEditor({
  config,
  data,
  onChange,
}: {
  config: unknown;
  data: unknown;
  onChange: (data: unknown) => void;
}): React.ReactElement {
  const [Puck, setPuck] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    import('@puckeditor/core').then((mod) => {
      setPuck(() => mod.Puck);
    });
  }, []);

  if (!Puck) {
    return <div className="template-manager-overlay__puck-loading">Loading editor...</div>;
  }

  return <Puck config={config} data={data} onChange={onChange} />;
}
