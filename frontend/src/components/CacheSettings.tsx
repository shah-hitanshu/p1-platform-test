/**
 * CacheSettings Component
 *
 * Manages per-site CDN/ISR cache TTL configuration.
 */

import { useState, useMemo } from 'react';
import { Button } from '@pantheon-systems/design-toolkit-react';

interface CacheSettingsProps {
  settings: { cacheTtlMain?: number; cacheTtlBranch?: number } | null;
  isLoading: boolean;
  onSave: (settings: { cacheTtlMain?: number | null; cacheTtlBranch?: number | null }) => Promise<void>;
  isSaving?: boolean;
}

function isValidPositiveInteger(value: string): boolean {
  if (value === '') return true;
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

/**
 * Generates a stable key from settings to detect when external settings change.
 */
function settingsKey(settings: CacheSettingsProps['settings']): string {
  if (!settings) return 'null';
  return `${settings.cacheTtlMain ?? ''}-${settings.cacheTtlBranch ?? ''}`;
}

export function CacheSettings({ settings, isLoading, onSave, isSaving = false }: CacheSettingsProps) {
  // Track the settings key to detect external changes
  const currentKey = settingsKey(settings);
  const [trackedKey, setTrackedKey] = useState(currentKey);
  const [mainTtl, setMainTtl] = useState(() =>
    settings?.cacheTtlMain != null ? String(settings.cacheTtlMain) : '',
  );
  const [branchTtl, setBranchTtl] = useState(() =>
    settings?.cacheTtlBranch != null ? String(settings.cacheTtlBranch) : '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // When settings change externally, reset local state
  // This pattern is recommended by React docs as an alternative to useEffect+setState
  const settingsChanged = useMemo(() => currentKey !== trackedKey, [currentKey, trackedKey]);
  if (settingsChanged) {
    setTrackedKey(currentKey);
    setMainTtl(settings?.cacheTtlMain != null ? String(settings.cacheTtlMain) : '');
    setBranchTtl(settings?.cacheTtlBranch != null ? String(settings.cacheTtlBranch) : '');
  }

  if (isLoading) {
    return <div data-testid="cache-settings-loading">Loading settings...</div>;
  }

  const handleSave = async () => {
    setValidationError(null);

    if (!isValidPositiveInteger(mainTtl) || !isValidPositiveInteger(branchTtl)) {
      setValidationError('Cache TTL values must be positive integers.');
      return;
    }

    const payload: { cacheTtlMain?: number | null; cacheTtlBranch?: number | null } = {};
    if (mainTtl !== '') {
      payload.cacheTtlMain = parseInt(mainTtl, 10);
    }
    if (branchTtl !== '') {
      payload.cacheTtlBranch = parseInt(branchTtl, 10);
    }

    await onSave(payload);
  };

  const handleReset = async () => {
    setValidationError(null);
    await onSave({ cacheTtlMain: null, cacheTtlBranch: null });
  };

  return (
    <div>
      <p data-testid="cache-settings-description">
        Configure CDN and ISR cache time-to-live (TTL) values in seconds for this site.
        Main branch content is cached longer for production performance, while preview
        branches use shorter TTLs for faster content updates during development.
      </p>

      <div>
        <label>
          Main branch cache TTL (seconds)
          <input
            type="text"
            data-testid="cache-ttl-main-input"
            value={mainTtl}
            onChange={(e) => { setMainTtl(e.target.value); setValidationError(null); }}
            placeholder="60"
            className="pds-input"
          />
        </label>
      </div>

      <div>
        <label>
          Preview branch cache TTL (seconds)
          <input
            type="text"
            data-testid="cache-ttl-branch-input"
            value={branchTtl}
            onChange={(e) => { setBranchTtl(e.target.value); setValidationError(null); }}
            placeholder="5"
            className="pds-input"
          />
        </label>
      </div>

      {validationError && (
        <div data-testid="cache-settings-validation-error" style={{ color: 'red', marginTop: '8px' }}>
          {validationError}
        </div>
      )}

      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <Button
          type="primary"
          data-testid="cache-settings-save-btn"
          onClick={handleSave}
          disabled={isSaving}
          isLoading={isSaving}
        >
          Save
        </Button>
        <Button
          type="secondary"
          data-testid="cache-settings-reset-btn"
          onClick={handleReset}
          disabled={isSaving}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
