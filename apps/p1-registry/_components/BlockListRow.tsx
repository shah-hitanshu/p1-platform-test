import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { CatalogItem } from '../lib/registry';

interface BlockListRowProps {
  item: CatalogItem;
}

export function BlockListRow({ item }: BlockListRowProps) {
  const category = item.categories?.[0];

  return (
    <Link href={`/blocks/${item.name}`} className="p1-block-list__row">
      <div className="p1-block-list__row-left">
        <h2>{item.title ?? item.name}</h2>
        {category && <span className="p1-tag" data-category={category}>{category}</span>}
      </div>
      <ChevronRight aria-hidden="true" />
    </Link>
  );
}
