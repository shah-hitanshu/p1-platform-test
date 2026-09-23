import { useGetPuck } from '@puckeditor/core';
import { Button } from '@pantheon-systems/pds-toolkit-react';
import isEqual from 'lodash.isequal';
import type { ChangeSummary, ChangeSummaryEntry } from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { localeLabel } from '../locale-labels.js';
import { resolveComponentLabel, resolveFieldLabel, resolveFieldType } from '../resolve-change-label.js';
import { entryKey, replacementState, type ReviewSession } from '../review-session.js';
import {
  replaceReviewValue,
  revealReviewTarget,
  useReviewTarget,
  useReviewValue,
} from '../review-editor.js';
import styles from './UpstreamChanges.module.css';
import { ReviewValue, structuralDescription } from './upstream-change-presentation.js';

interface UpstreamChangeRowProps {
  entry: ChangeSummaryEntry;
  summary: ChangeSummary;
  documentLocale: string | undefined;
  session: ReviewSession;
  pending: boolean;
  onResolve: () => void;
}

export function UpstreamChangeRow({
  entry,
  summary,
  documentLocale,
  session,
  pending,
  onResolve,
}: UpstreamChangeRowProps) {
  // Source values come from the comparison; current values always come from Puck.
  const target = useReviewTarget(entry.componentId, entry.propPath);
  const key = entryKey(entry);
  const record = session.replacements.get(key);
  const replacement = record?.sourceDocumentId === summary.upstreamDocumentId ? record : undefined;
  const recoveryValue = useReviewValue(entry.componentId, replacement?.pointer);

  const getEditor = useGetPuck();
  const css = useP1PuckOptional();
  const notifications = css?.notifications;
  const componentLabel = resolveComponentLabel(target.config, entry.componentId, target.type);
  const sourceLabel = summary.relationType === 'localization' ? 'Source' : 'Template';

  // A canonical page carries no locale of its own until it is authored in one,
  // so the source column names a market only when the source document holds it.
  const sourceLocale = css?.documents.find(
    (document) => document.id === summary.upstreamDocumentId,
  )?.locale;
  const sourceTag = sourceLocale == null ? null : localeLabel(sourceLocale).tag;

  if (entry.classification === 'structural') {
    return (
      <StructuralChange
        entry={entry}
        componentLabel={componentLabel}
        sourceLabel={sourceLabel}
      />
    );
  }

  const pointer = entry.propPath;
  if (pointer === undefined) return null;

  const recoveryState = replacementState(replacement, recoveryValue);
  const hasActiveReplacement = recoveryState !== 'original';
  const canRollback = target.available && recoveryState === 'replaced';

  // An unrelated source edit advances the version without changing this field.
  const hasNewSourceValue = replacement !== undefined
    && replacement.sourceVersionId !== summary.toVersionId
    && !isEqual(replacement.sourceValue, entry.upstreamNewValue);
  const replacementBlocked = hasActiveReplacement && !hasNewSourceValue;

  const needsTranslation = entry.classification === 'needsTranslation';
  const locale = documentLocale === undefined ? null : localeLabel(documentLocale);
  const fieldLabel = resolveFieldLabel(target.config, entry.componentId, pointer, target.type);
  const richtext = resolveFieldType(target.config, entry.componentId, pointer, target.type) === 'richtext';

  // Previewing a replacement that is already in the field, or one the page has
  // no field to take, would show the reader their own current value back.
  const showsReplacement = needsTranslation && target.available && !replacementBlocked;

  const apply = () => {
    if (pending || (needsTranslation && replacementBlocked)) return;

    const inserted = entry.upstreamNewValue === undefined
      ? { exists: false as const }
      : { exists: true as const, value: entry.upstreamNewValue };
    const editor = getEditor();
    const operation = replaceReviewValue(editor, entry.componentId, pointer, inserted);

    if (operation === null) {
      notifications?.addError(`Nothing to update: this page no longer holds ${componentLabel}. Add the block back on the canvas to take this change.`);
      return;
    }

    revealReviewTarget(editor, entry.componentId);

    // Source wording is a starting point for translation, not a completed review.
    if (needsTranslation) {
      session.remember(key, {
        sourceDocumentId: summary.upstreamDocumentId,
        sourceVersionId: summary.toVersionId,
        sourceValue: entry.upstreamNewValue,
        ...operation,
      });
    } else {
      onResolve();
    }
  };

  const rollback = () => {
    if (!replacement || pending) return;

    const restored = replaceReviewValue(
      getEditor(), entry.componentId, replacement.pointer, replacement.before, replacement.inserted,
    );

    if (restored === null) {
      notifications?.addError('This field has changed. Use editor undo to step back through those edits.');
    }
  };

  return (
    <div className={styles.row}>
      <div className={styles.field}>{componentLabel} · {fieldLabel}</div>
      <div className={styles.cols}>
        <div className={styles.col}>
          <span className={styles.colLabel}>
            {sourceLabel}
            {sourceTag !== null && (
              <> (<span className={styles.flag} data-testid="upstream-source-locale">{sourceTag}</span>)</>
            )}
            {' · '}v{summary.toVersion}
          </span>
          <span
            className={styles.value}
            data-testid="upstream-new-value"
            dir="auto"
          >
            <ReviewValue value={entry.upstreamNewValue} richtext={richtext} />
          </span>
        </div>
        <div className={styles.col}>
          <span className={styles.colLabel}>
            {locale === null
              ? 'Current page'
              : <>Current <span className={styles.flag} data-testid="upstream-current-locale">{locale.tag}</span></>}
            {' · '}v{summary.fromVersion} (out of sync)
          </span>
          <span
            className={`${styles.value} ${target.available ? styles.valueStale : ''}`}
            data-testid="upstream-current-value"
            dir={locale?.dir ?? 'auto'}
            lang={locale?.lang}
          >
            {target.available
              ? <ReviewValue value={target.field.exists ? target.field.value : undefined} richtext={richtext} />
              : 'Block unavailable'}
          </span>
          {showsReplacement && (
            <>
              <span className={`${styles.colLabel} ${styles.replaceLabel}`}>Replace with</span>
              <span
                className={`${styles.value} ${styles.valueStale}`}
                data-testid="upstream-replacement-preview"
                dir="auto"
              >
                <ReviewValue value={entry.upstreamNewValue} richtext={richtext} />
              </span>
            </>
          )}
        </div>
      </div>
      <div className={styles.actions}>
        {needsTranslation ? (
          <>
            <Button
              data-testid="upstream-apply-draft"
              label={replacementBlocked ? 'Replaced' : 'Replace with Source'}
              variant="primary"
              size="s"
              disabled={pending || !target.available || replacementBlocked}
              onClick={apply}
            />
            <Button
              data-testid="upstream-mark-done"
              label="Mark done"
              variant="secondary"
              size="s"
              disabled={pending}
              onClick={onResolve}
            />
            {hasActiveReplacement && (
              <Button
                data-testid="upstream-rollback"
                label="Rollback change"
                variant="secondary"
                size="s"
                disabled={pending || !canRollback}
                onClick={rollback}
              />
            )}
          </>
        ) : (
          <Button
            data-testid="upstream-apply"
            label="Apply update"
            variant="primary"
            size="s"
            disabled={pending || !target.available}
            onClick={apply}
          />
        )}
      </div>
      {hasActiveReplacement && !canRollback && target.available && (
        <p className={styles.note}>This field has been edited since replacement. Use editor undo to step back through those edits.</p>
      )}
      {hasActiveReplacement && hasNewSourceValue && (
        <p className={styles.note}>The source changed again after this replacement. Replacing it will overwrite the current field value.</p>
      )}
    </div>
  );
}

function StructuralChange({ entry, componentLabel, sourceLabel }: {
  entry: ChangeSummaryEntry;
  componentLabel: string;
  sourceLabel: string;
}) {
  const source = sourceLabel === 'Source' ? 'source' : 'template';
  const kind = entry.structuralKind ?? 'changed';
  const description = structuralDescription(kind, source);

  return (
    <div className={styles.row}>
      <div className={styles.field}>
        {componentLabel}
        <span className={styles.ownership} data-testid="upstream-structural-kind">{kind}</span>
      </div>
      <p className={`${styles.note} ${styles.structuralNote}`} data-testid="upstream-structural-note">
        {description.prefix}<strong>{componentLabel}</strong>{description.suffix}
      </p>
    </div>
  );
}
