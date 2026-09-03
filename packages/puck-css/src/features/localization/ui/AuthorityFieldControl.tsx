/**
 * Authority Field Control
 *
 * Per-prop localization controls for the fields panel, rendered as the
 * fieldTypes override for text/textarea props. The two controls live on
 * different documents:
 *  - authority break/reset (translation only): break inheritance from the
 *    canonical (authority 'locale') or reset back to inheriting;
 *  - translatability toggle (canonical page only): mark whether the prop is
 *    natural-language text worth translating (default on). This decision is
 *    shared across languages, so it belongs to the canonical page.
 *
 * Document-scoped state and writes come from useLocalizationData; this control
 * projects them onto one prop. The prop the field addresses comes from the props
 * Puck passes to a fieldTypes override, and a field addressing no prop the
 * stored maps can key carries no controls.
 */

import React from 'react';
import { resolveAuthority } from '../authority.js';
import { resolvePropTarget } from '../prop-target.js';
import { isPropTranslatable } from '../translatable.js';
import { useLocalizationData } from '../useLocalizationData.js';
import { TranslatabilityToggle } from './TranslatabilityToggle.js';

interface AuthorityFieldControlProps {
  children: React.ReactNode;
  name: string;
  id?: string;
  field?: { type?: string };
  readOnly?: boolean;
  onChange?: (value: unknown, ui?: unknown) => void;
  value?: unknown;
}

export function AuthorityFieldControl(props: AuthorityFieldControlProps): React.ReactElement {
  const { children, name, id, field, readOnly } = props;
  const {
    isTranslation,
    isCanonical,
    loaded,
    authority,
    translatableMap,
    busy,
    setAuthority,
    setTranslatable,
  } = useLocalizationData();

  const target = resolvePropTarget(id, field?.type, name);

  if (target === null || (!isTranslation && !isCanonical)) return <>{children}</>;

  const { slotId, propName } = target;
  const broken = resolveAuthority(authority, slotId, propName) === 'locale';
  const translatable = isPropTranslatable(translatableMap, slotId, propName);

  const buttonStyle: React.CSSProperties = {
    fontSize: 'var(--puck-font-size-xxxs, 12px)',
    fontWeight: 500,
    background: 'var(--puck-color-white, #fff)',
    border: '1px solid var(--puck-color-grey-09, #dcdcdc)',
    borderRadius: 4,
    padding: '2px 6px',
    cursor: busy ? 'default' : 'pointer',
  };

  return (
    <div style={{ paddingBottom: 2 }}>
      {children}
      {!readOnly && loaded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {isTranslation &&
            (broken ? (
              <button
                type="button"
                data-testid="loc-authority-reset"
                title="Reset to inherit from the canonical page"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setAuthority({ slotId, propName, authority: 'canonical' });
                }}
                style={{ ...buttonStyle, color: 'var(--puck-color-azure-04, #0158ad)' }}
              >
                Reset
              </button>
            ) : (
              <button
                type="button"
                data-testid="loc-authority-break"
                title="Break inheritance and edit this prop for this language"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setAuthority({ slotId, propName, authority: 'locale' });
                }}
                style={{ ...buttonStyle, color: 'var(--puck-color-grey-05, #767676)' }}
              >
                Inherited
              </button>
            ))}
          {isCanonical && (
            <TranslatabilityToggle
              translatable={translatable}
              onToggle={(next) => setTranslatable({ slotId, propName, translatable: next })}
            />
          )}
        </div>
      )}
    </div>
  );
}
