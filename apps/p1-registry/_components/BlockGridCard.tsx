import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { CatalogItem } from '../lib/registry';
import { previewNames } from '../lib/preview-names';

interface BlockGridCardProps {
  item: CatalogItem;
}

export function BlockGridCard({ item }: BlockGridCardProps) {
  const hasPreview = previewNames.includes(item.name);
  const category = item.categories?.[0];

  return (
    <Link href={`/blocks/${item.name}`} className="p1-block-card">
      <div className="p1-block-card__bar">
        <div className="p1-block-card__bar-left">
          <h2 className="p1-block-card__title">{item.title ?? item.name}</h2>
          {category && <span className="p1-tag" data-category={category}>{category}</span>}
        </div>
        <ChevronRight aria-hidden="true" />
      </div>
      {hasPreview ? (
        <div className="p1-block-card__preview">
          <iframe
            src={`/preview/${item.name}`}
            title={`Preview of ${item.title ?? item.name}`}
            scrolling="no"
            tabIndex={-1}
            aria-hidden="true"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="p1-block-card__no-preview">No preview</div>
      )}
    </Link>
  );
}
