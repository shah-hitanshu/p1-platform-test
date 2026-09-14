/**
 * Translation Glyph
 *
 * The per-prop localization affordance in a field's label row: a glyph that
 * opens the prop's translation settings and states which setting the prop
 * carries — a globe where it holds its default, a lock where the canonical page
 * shares it across languages, a pencil where a translation owns it. It takes the
 * row's shared box and reveal.
 *
 * Which setting the popover carries follows the open document: a translation
 * owns the authority of its props, and the canonical page owns the
 * translatability decision every language shares.
 */

import React, { useState } from 'react';
import { Popover } from '@pantheon-systems/pds-toolkit-react';
import { GlobeIcon } from '../../../p1/editor/icons/globe-icon.js';
import { LockIcon } from '../../../p1/editor/icons/lock-icon.js';
import { PencilIcon } from '../../../p1/editor/icons/pencil-icon.js';
import { resolveAuthority } from '../authority.js';
import { isPropTranslatable } from '../translatable.js';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { useLocalizationData } from '../useLocalizationData.js';
import { useSiteMarkets } from '../useSiteMarkets.js';
import type { PropTarget } from '../prop-target.js';
import { AuthorityToggle } from './AuthorityToggle.js';
import { TranslatabilityToggle } from './TranslatabilityToggle.js';
import { useFieldTarget } from './field-target-context.js';
import styles from './TranslationGlyph.module.css';

export interface TranslationGlyphProps {
  target: PropTarget;
  /** The field's label, named in the glyph's tooltip. */
  label: string;
  readOnly?: boolean;
}

export function TranslationGlyph(props: TranslationGlyphProps): React.ReactElement | null {
  // No editor context means no document to hold a setting, and none of the
  // stores the setting is read from. Gate before the reads rather than in them.
  const css = useP1PuckOptional();
  if (!css?.client || !css.currentDocument) return null;
  return <ConnectedTranslationGlyph {...props} />;
}

function ConnectedTranslationGlyph({
  target,
  label,
  readOnly,
}: TranslationGlyphProps): React.ReactElement | null {
  const {
    isTranslation,
    isCanonical,
    loaded,
    authority,
    translatableMap,
    setAuthority,
    setTranslatable,
  } = useLocalizationData();
  const { markets, failed: marketsFailed } = useSiteMarkets();
  const [open, setOpen] = useState(false);

  const { slotId, propName } = target;

  // A site publishing into no locale has nothing for a prop to diverge into, so
  // its fields carry no setting. The locale switcher hides on the same test.
  // A settings read that failed answers nothing, so the control stays: a
  // transient outage should not read as a site without locales.
  if (!marketsFailed && markets.length === 0) return null;

  // A translation's authority is the server's answer; absent, every prop reads
  // inherited, which is indistinguishable from a read that failed. Withhold the
  // glyph rather than marking the field with a state nobody said.
  if (!isCanonical && !(isTranslation && loaded)) return null;

  const broken = resolveAuthority(authority, slotId, propName) === 'locale';
  const translatable = isPropTranslatable(translatableMap, slotId, propName);
  const diverged = isTranslation ? broken : !translatable;

  // Each state gets its own glyph rather than a mark laid over the globe: a
  // hairline slash across a hairline icon reads as another meridian at 14px.
  const description = isTranslation
    ? broken
      ? `${label} is written for this language`
      : `${label} follows the source page`
    : translatable
      ? `${label} is translatable`
      : `${label} is not translated`;
  const Glyph = !diverged ? GlobeIcon : isTranslation ? PencilIcon : LockIcon;

  const trigger = (
    <span
      className="p1-field-label-action"
      data-testid="loc-translation-glyph"
      data-diverged={diverged ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      title={description}
    >
      <span className="visually-hidden">{description}</span>
      <Glyph />
    </span>
  );

  const content = isTranslation ? (
    <AuthorityToggle
      broken={broken}
      readOnly={readOnly}
      onToggle={(next) =>
        setAuthority({ slotId, propName, authority: next ? 'locale' : 'canonical' })
      }
    />
  ) : (
    <TranslatabilityToggle
      translatable={translatable}
      readOnly={readOnly}
      onToggle={(next) => setTranslatable({ slotId, propName, translatable: next })}
    />
  );

  // No close button on the popover: it is what puts PDS in a focus trap that
  // hides the rest of the editor from assistive tech, which one switch does not
  // warrant. Clicking away, Escape, and the glyph itself all close it.
  return (
    <span className={styles.slot}>
      <Popover
        customTrigger={trigger}
        content={content}
        title="Translation"
        classNameContainer={styles.popover}
        placement="bottom-end"
        popoverIsOpen={open}
        setPopoverIsOpen={setOpen}
      />
    </span>
  );
}

/**
 * The glyph for whichever prop the surrounding field addresses. A label rendered
 * outside a localizable field — a nested subfield's among them — marks nothing.
 */
export function FieldTranslationGlyph({
  label,
  readOnly,
}: {
  label: string;
  readOnly?: boolean;
}): React.ReactElement | null {
  const target = useFieldTarget();
  if (!target) return null;
  return <TranslationGlyph target={target} label={label} readOnly={readOnly} />;
}
