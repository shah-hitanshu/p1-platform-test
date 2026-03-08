/**
 * ScopeSelector Component
 *
 * Allows users to select API token scopes with supersession
 * and minimum-selection logic.
 */

interface ScopeSelectorProps {
  selectedScopes: string[];
  onChange: (scopes: string[]) => void;
}

const SCOPE_OPTIONS = [
  { value: 'read:published', label: 'Published content (main branch only)' },
  { value: 'read:all', label: 'All branch content' },
  { value: 'read:draft', label: 'Draft data (editor API)' },
] as const;

export function ScopeSelector({ selectedScopes, onChange }: ScopeSelectorProps) {
  const handleToggle = (scope: string) => {
    const isSelected = selectedScopes.includes(scope);

    if (isSelected) {
      // Don't allow unchecking the last scope
      const newScopes = selectedScopes.filter((s) => s !== scope);
      if (newScopes.length === 0) return;
      onChange(newScopes);
    } else {
      // Adding a scope
      let newScopes = [...selectedScopes, scope];

      // read:all supersedes read:published
      if (scope === 'read:all') {
        newScopes = newScopes.filter((s) => s !== 'read:published');
      }

      onChange(newScopes);
    }
  };

  return (
    <div data-testid="scope-selector">
      {SCOPE_OPTIONS.map((option) => (
        <label key={option.value} style={{ display: 'block', marginBottom: '4px' }}>
          <input
            type="checkbox"
            checked={selectedScopes.includes(option.value)}
            onChange={() => handleToggle(option.value)}
          />
          {' '}{option.label}
        </label>
      ))}
      {selectedScopes.includes('read:draft') && (
        <p data-testid="draft-scope-note">
          Draft scope grants full access to all content including unpublished drafts.
        </p>
      )}
    </div>
  );
}
