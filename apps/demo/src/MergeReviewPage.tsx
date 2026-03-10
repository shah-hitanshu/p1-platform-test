/**
 * Merge Review Page
 *
 * Demonstrates the Phase 3c-5 merge features:
 * - BranchMergeCompare: side-by-side branch visual comparison
 * - DocumentDiffList: multi-document diff summary
 * - PuckFieldResolutionPanel: Puck-aware field-level conflict resolution
 * - MergePreviewPanel: rendered merge preview with view modes
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  DocumentDiffList,
  PuckFieldResolutionPanel,
  MergePreviewPanel,
  MergePreviewRenderer,
  ViewModeSelector,
  createBranchDocumentComparison,
  diffPuckDataWithPositions,
  isPuckData,
} from '@pantheon/puck-css';
import type {
  BranchDocumentComparison,
  DocumentDiffSummary,
  ViewMode,
  PuckData,
  Branch,
} from '@pantheon/puck-css';
import { puckConfig } from './puck.config';

// Environment configuration
const config = {
  baseUrl: import.meta.env.VITE_CSS_BASE_URL || 'http://localhost:8787',
  siteId: import.meta.env.VITE_CSS_SITE_ID || '',
};

// Token storage key
const TOKEN_KEY = 'css_auth_token';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

interface MergePreviewResponse {
  canMerge: boolean;
  hasConflicts: boolean;
  conflicts: {
    documentConflicts: {
      documentId: string;
      documentPath: string;
      conflictType: string;
      sourceVersion?: number;
      targetVersion?: number;
    }[];
  };
  sourceChanges: { documentId: string; documentPath: string; latestVersionId: string }[];
  targetChanges: { documentId: string; documentPath: string; latestVersionId: string }[];
  documentDiffs?: {
    documentId: string;
    documentPath: string;
    sourceSnapshot: Record<string, unknown> | null;
    targetSnapshot: Record<string, unknown> | null;
    diffOperations: unknown[];
  }[];
}

type DemoTab = 'diff-list' | 'visual-compare' | 'merge-preview' | 'conflict-resolution';

export function MergeReviewPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [preview, setPreview] = useState<MergePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DemoTab>('diff-list');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');

  // Fetch branches on mount
  useEffect(() => {
    if (!config.siteId) return;
    apiFetch<{ branches: Branch[] }>(
      `/api/sites/${config.siteId}/branches`
    )
      .then((res) => {
        setBranches(res.branches ?? []);
        // Auto-select first two branches if available
        if (res.branches && res.branches.length >= 2) {
          const main = res.branches.find((b) => b.name === 'main');
          const other = res.branches.find((b) => b.name !== 'main');
          if (main && other) {
            setTargetBranchId(main.id);
            setSourceBranchId(other.id);
          } else {
            setSourceBranchId(res.branches[0].id);
            setTargetBranchId(res.branches[1].id);
          }
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const sourceBranch = branches.find((b) => b.id === sourceBranchId);
  const targetBranch = branches.find((b) => b.id === targetBranchId);
  const sourceName = sourceBranch?.name ?? 'Source';
  const targetName = targetBranch?.name ?? 'Target';

  // Fetch merge preview
  const fetchPreview = useCallback(async () => {
    if (!sourceBranchId || !targetBranchId || sourceBranchId === targetBranchId) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await apiFetch<MergePreviewResponse>(
        `/api/sites/${config.siteId}/merge/preview`,
        {
          method: 'POST',
          body: JSON.stringify({
            sourceBranchId,
            targetBranchId,
            includeContent: true,
          }),
        }
      );
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sourceBranchId, targetBranchId]);

  // Build document comparisons for DocumentDiffList
  const documentComparisons = useMemo((): BranchDocumentComparison[] => {
    if (!preview?.documentDiffs) return [];
    return preview.documentDiffs
      .filter((d) => d.sourceSnapshot || d.targetSnapshot)
      .map((d) => {
        const src = d.sourceSnapshot as unknown as PuckData | null;
        const tgt = d.targetSnapshot as unknown as PuckData | null;
        if (src && tgt && isPuckData(src) && isPuckData(tgt)) {
          return createBranchDocumentComparison(
            d.documentId,
            d.documentPath,
            src,
            tgt
          );
        }
        // Fallback for non-Puck data
        return {
          documentId: d.documentId,
          documentPath: d.documentPath,
          isPuckData: false,
          diffs: [],
          counts: {
            added: 0,
            removed: 0,
            modified: d.diffOperations.length,
            unchanged: 0,
          },
        } satisfies BranchDocumentComparison;
      });
  }, [preview]);

  // Build data for MergePreviewPanel
  const mergePreviewDocs = useMemo((): DocumentDiffSummary[] => {
    if (!preview?.documentDiffs) return [];
    return preview.documentDiffs.map((d) => ({
      documentId: d.documentId,
      documentPath: d.documentPath,
      sourceSnapshot: d.sourceSnapshot,
      targetSnapshot: d.targetSnapshot,
    }));
  }, [preview]);

  // Get selected document data for visual compare
  const selectedDoc = preview?.documentDiffs?.find((d) => d.documentId === selectedDocId);
  const selectedDiffs = useMemo(() => {
    if (!selectedDoc?.sourceSnapshot || !selectedDoc?.targetSnapshot) return [];
    const src = selectedDoc.sourceSnapshot as unknown as PuckData;
    const tgt = selectedDoc.targetSnapshot as unknown as PuckData;
    if (isPuckData(src) && isPuckData(tgt)) {
      // Target (main) is the baseline, source (branch) is the changed state
      return diffPuckDataWithPositions(tgt, src);
    }
    return [];
  }, [selectedDoc]);

  // Get conflicting document for resolution demo
  const conflictDoc = useMemo(() => {
    if (!preview) return null;
    const conflict = preview.conflicts.documentConflicts[0];
    if (!conflict) return null;
    const diff = preview.documentDiffs?.find((d) => d.documentId === conflict.documentId);
    if (!diff?.sourceSnapshot || !diff?.targetSnapshot) return null;
    const src = diff.sourceSnapshot as unknown as PuckData;
    const tgt = diff.targetSnapshot as unknown as PuckData;
    if (!isPuckData(src) || !isPuckData(tgt)) return null;
    return { conflict, source: src, target: tgt, path: diff.documentPath };
  }, [preview]);

  if (!config.siteId) {
    return (
      <div style={styles.page}>
        <p>Set VITE_CSS_SITE_ID to use merge review.</p>
        <Link to="/" style={styles.backLink}>Back to editor</Link>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/" style={styles.backLink}>&larr; Editor</Link>
          <h1 style={styles.title}>Merge review</h1>
        </div>
      </header>

      {/* Branch Selectors */}
      <div style={styles.branchSelectors}>
        <div style={styles.branchField}>
          <label style={styles.label}>Source branch</label>
          <select
            value={sourceBranchId}
            onChange={(e) => setSourceBranchId(e.target.value)}
            style={styles.select}
          >
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <span style={styles.arrow}>&rarr;</span>
        <div style={styles.branchField}>
          <label style={styles.label}>Target branch</label>
          <select
            value={targetBranchId}
            onChange={(e) => setTargetBranchId(e.target.value)}
            style={styles.select}
          >
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={fetchPreview}
          disabled={loading || !sourceBranchId || !targetBranchId || sourceBranchId === targetBranchId}
          style={styles.compareBtn}
        >
          {loading ? 'Loading...' : 'Compare branches'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {preview && (
        <>
          {/* Status Banner */}
          <div style={{
            ...styles.statusBanner,
            backgroundColor: preview.hasConflicts ? '#fff3cd' : '#d4edda',
            borderColor: preview.hasConflicts ? '#ffc107' : '#28a745',
          }}>
            {preview.hasConflicts ? (
              <span>
                {preview.conflicts.documentConflicts.length} conflict(s) detected
                between <strong>{sourceName}</strong> and <strong>{targetName}</strong>
              </span>
            ) : (
              <span>
                No conflicts. {sourceName} can be merged into {targetName}.
              </span>
            )}
          </div>

          {/* Tab Navigation */}
          <div style={styles.tabs}>
            {(['diff-list', 'visual-compare', 'merge-preview', 'conflict-resolution'] as DemoTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  ...styles.tab,
                  ...(activeTab === tab ? styles.activeTab : {}),
                }}
                disabled={tab === 'conflict-resolution' && !conflictDoc}
              >
                {tab === 'diff-list' && 'Document diffs'}
                {tab === 'visual-compare' && 'Visual compare'}
                {tab === 'merge-preview' && 'Merge preview'}
                {tab === 'conflict-resolution' && `Conflict resolution${!conflictDoc ? ' (no conflicts)' : ''}`}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={styles.content}>
            {activeTab === 'diff-list' && (
              <DocumentDiffList
                documents={documentComparisons}
                sourceBranchName={sourceName}
                targetBranchName={targetName}
              />
            )}

            {activeTab === 'visual-compare' && (
              <div>
                {!selectedDocId && (
                  <div style={styles.selectPrompt}>
                    Select a document to compare visually:
                    <div style={styles.docList}>
                      {(preview.documentDiffs ?? []).map((d) => (
                        <button
                          key={d.documentId}
                          onClick={() => setSelectedDocId(d.documentId)}
                          style={styles.docBtn}
                        >
                          {d.documentPath}
                          <span style={styles.changeCount}>
                            {d.diffOperations.length} change(s)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedDocId && selectedDoc?.sourceSnapshot && selectedDoc?.targetSnapshot && (
                  <div>
                    <div style={styles.visualCompareToolbar}>
                      <button
                        onClick={() => setSelectedDocId(null)}
                        style={styles.backBtn}
                      >
                        &larr; Back to documents
                      </button>
                      <ViewModeSelector
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                      />
                    </div>
                    <MergePreviewRenderer
                      sourceData={selectedDoc.sourceSnapshot as unknown as PuckData}
                      targetData={selectedDoc.targetSnapshot as unknown as PuckData}
                      diffs={selectedDiffs}
                      config={puckConfig}
                      viewMode={viewMode}
                      sourceBranchName={sourceName}
                      targetBranchName={targetName}
                    />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'merge-preview' && (
              <MergePreviewPanel
                documents={mergePreviewDocs}
                sourceBranchName={sourceName}
                targetBranchName={targetName}
                config={puckConfig}
                onDocumentSelect={(docId: string) => {
                  setSelectedDocId(docId);
                  setActiveTab('visual-compare');
                }}
              />
            )}

            {activeTab === 'conflict-resolution' && conflictDoc && (
              <div>
                <h3 style={styles.sectionTitle}>
                  Resolving: {conflictDoc.path}
                </h3>
                <PuckFieldResolutionPanel
                  sourceSnapshot={conflictDoc.source}
                  targetSnapshot={conflictDoc.target}
                  baseSnapshot={null}
                  sourceBranchName={sourceName}
                  targetBranchName={targetName}
                  onResolve={(merged: PuckData) => {
                    console.log('Resolved merge snapshot:', merged);
                    alert('Resolution applied (logged to console). In production, this would submit via the merge API.');
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Inline styles for the demo page
const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  backLink: {
    color: '#0066cc',
    textDecoration: 'none',
    fontSize: '14px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
  },
  branchSelectors: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '12px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  branchField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  select: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #ccc',
    fontSize: '14px',
    minWidth: '200px',
  },
  arrow: {
    fontSize: '20px',
    color: '#666',
    paddingBottom: '6px',
  },
  compareBtn: {
    padding: '8px 20px',
    borderRadius: '6px',
    border: 'none',
    background: '#0066cc',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  error: {
    background: '#fde8e8',
    color: '#c53030',
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '16px',
  },
  statusBanner: {
    padding: '12px 16px',
    borderRadius: '6px',
    border: '1px solid',
    marginBottom: '16px',
    fontSize: '14px',
  },
  tabs: {
    display: 'flex',
    gap: '0',
    borderBottom: '2px solid #e5e7eb',
    marginBottom: '24px',
  },
  tab: {
    padding: '10px 20px',
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    color: '#666',
    marginBottom: '-2px',
  },
  activeTab: {
    color: '#0066cc',
    borderBottomColor: '#0066cc',
  },
  content: {
    minHeight: '400px',
  },
  selectPrompt: {
    textAlign: 'center' as const,
    padding: '40px 20px',
    color: '#666',
  },
  docList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    marginTop: '16px',
    alignItems: 'center',
  },
  docBtn: {
    padding: '10px 20px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  changeCount: {
    fontSize: '12px',
    color: '#666',
    background: '#f0f0f0',
    padding: '2px 8px',
    borderRadius: '10px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 500,
    marginBottom: '16px',
  },
  visualCompareToolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    padding: '8px 0',
    borderBottom: '1px solid #e5e7eb',
  },
  backBtn: {
    padding: '6px 14px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#333',
  },
};
