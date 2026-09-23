import type { ChangeSummaryEntry } from '@pantheon-systems/css-client';
import { PropValueDisplay } from '../../../versioning/components/version-compare/index.js';
import styles from './UpstreamChanges.module.css';

type StructuralKind = NonNullable<ChangeSummaryEntry['structuralKind']> | 'changed';

export function structuralSummary(count: number, source: 'source' | 'template'): string {
  const blocks = count === 1 ? 'block' : 'blocks';
  const context = source === 'source'
    ? 'this localization'
    : 'this page';

  return `${String(count)} ${blocks} changed in the ${source} version used for ${context}.`;
}

export function structuralDescription(kind: StructuralKind, source: 'source' | 'template'): {
  prefix: string;
  suffix: string;
} {
  const descriptions = {
    added: { prefix: 'New ', suffix: ` block added to the ${source} page. Reconcile this on the canvas.` },
    removed: { prefix: '', suffix: ` block was removed from the ${source} page. Reconcile this on the canvas.` },
    moved: { prefix: '', suffix: ` block was moved on the ${source} page. Reconcile this on the canvas.` },
    changed: { prefix: '', suffix: ` block changed on the ${source} page. Reconcile this on the canvas.` },
  };

  return descriptions[kind];
}

export function ReviewValue({ value, richtext }: { value: unknown; richtext: boolean }) {
  const display = <PropValueDisplay value={value} />;

  return richtext
    ? <code className={styles.richtextValue} data-testid="upstream-richtext-value">{display}</code>
    : display;
}
