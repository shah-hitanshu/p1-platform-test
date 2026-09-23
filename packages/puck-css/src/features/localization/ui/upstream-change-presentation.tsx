import type { ChangeSummaryEntry } from '@pantheon-systems/css-client';
import { useState } from 'react';
import { PropValueDisplay } from '../../../versioning/components/version-compare/index.js';
import type { FieldPresentation } from '../resolve-change-label.js';
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

function imageValue(value: unknown): { url: string | null; alt: string | null } {
  if (typeof value === 'string') return { url: value || null, alt: null };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { url: null, alt: null };
  }

  const record = value as Record<string, unknown>;
  return {
    url: typeof record.url === 'string' && record.url !== '' ? record.url : null,
    alt: typeof record.alt === 'string' && record.alt !== '' ? record.alt : null,
  };
}

function imageName(url: string): string {
  if (url.startsWith('data:image/')) return 'Embedded image';

  try {
    const pathname = new URL(url, 'https://example.invalid').pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? url);
  } catch {
    return url;
  }
}

function ImageThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <img
      className={styles.imagePreview}
      src={url}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function ImageReviewValue({ value }: { value: unknown }) {
  const { url, alt } = imageValue(value);

  return (
    <span className={styles.imageValue}>
      {url !== null && <ImageThumbnail key={url} url={url} />}
      <span className={styles.imageDetails} data-testid="upstream-image-details" title={url ?? undefined}>
        {alt !== null && <span className={styles.imageAlt}>{alt}</span>}
        <span className={styles.imageName}>
          {url === null ? <PropValueDisplay value={value} /> : imageName(url)}
        </span>
      </span>
    </span>
  );
}

export function ReviewValue({
  value,
  richtext = false,
  presentation = richtext ? 'richtext' : 'default',
}: {
  value: unknown;
  richtext?: boolean;
  presentation?: FieldPresentation;
}) {
  const display = <PropValueDisplay value={value} />;

  if (presentation === 'image') return <ImageReviewValue value={value} />;
  if (presentation === 'richtext') {
    return <code className={styles.richtextValue} data-testid="upstream-richtext-value">{display}</code>;
  }

  return display;
}
