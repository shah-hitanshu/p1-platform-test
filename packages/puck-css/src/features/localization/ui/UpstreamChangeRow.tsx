import { useGetPuck } from '@puckeditor/core';
import { Button } from '@pantheon-systems/pds-toolkit-react';
import isEqual from 'lodash.isequal';
import type { ChangeSummary, ChangeSummaryEntry } from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import { PropValueDisplay } from '../../../versioning/components/version-compare/index.js';
import { localeLabel } from '../locale-labels.js';
import { resolveComponentLabel, resolveFieldLabel } from '../resolve-change-label.js';
import { entryKey, replacementState, type ReviewSession } from '../review-session.js';
import { replaceReviewValue, useReviewTarget, useReviewValue } from '../review-editor.js';
import styles from './UpstreamChanges.module.css';

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
  const notifications = useP1PuckOptional()?.notifications;
  const componentLabel = resolveComponentLabel(target.config, entry.componentId, target.type);
  const sourceLabel = summary.relationType === 'localization' ? 'Source' : 'Template';

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
  const advisory = entry.classification === 'advisory';
  const locale = documentLocale === undefined ? null : localeLabel(documentLocale);
  const fieldLabel = resolveFieldLabel(target.config, entry.componentId, pointer, target.type);

  const apply = () => {
    if (pending || (needsTranslation && replacementBlocked)) return;

    const inserted = entry.upstreamNewValue === undefined
      ? { exists: false as const }
      : { exists: true as const, value: entry.upstreamNewValue };
    const operation = replaceReviewValue(getEditor(), entry.componentId, pointer, inserted);

    if (operation === null) {
      notifications?.addError(`Nothing to update: this page no longer holds ${componentLabel}. Reconcile it on the canvas.`);
      return;
    }

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
          <span className={styles.colLabel}>{sourceLabel} · v{summary.toVersion}</span>
          <span
            className={`${styles.value} ${advisory ? styles.valueMuted : ''}`}
            data-testid="upstream-new-value"
            dir="auto"
          >
            <PropValueDisplay value={entry.upstreamNewValue} />
          </span>
        </div>
        <div className={styles.col}>
          <span className={styles.colLabel}>{locale === null ? 'Current page' : `Current ${locale.tag}`}</span>
          <span
            className={styles.value}
            data-testid="upstream-current-value"
            dir={locale?.dir ?? 'auto'}
            lang={locale?.lang}
          >
            {target.available
              ? <PropValueDisplay value={target.field.exists ? target.field.value : undefined} />
              : 'Block unavailable'}
          </span>
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
        ) : advisory ? (
          <Button
            data-testid="upstream-dismiss"
            label="Dismiss"
            variant="secondary"
            size="s"
            disabled={pending}
            onClick={onResolve}
          />
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
  const source = sourceLabel.toLowerCase();
  const descriptions = {
    added: `New ${componentLabel} added to the ${source} page.`,
    removed: `${componentLabel} was removed from the ${source} page.`,
    moved: `${componentLabel} was moved on the ${source} page.`,
    changed: `${componentLabel} changed on the ${source} page.`,
  };
  const description = descriptions[entry.structuralKind ?? 'changed'];

  return (
    <div className={styles.row}>
      <div className={styles.field}>{componentLabel}</div>
      <p className={styles.note} data-testid="upstream-structural-note">
        {description} Reconcile this on the canvas.
      </p>
    </div>
  );
}
