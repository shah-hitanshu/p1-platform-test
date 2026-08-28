'use client';
import * as React from 'react';
import type { CatalogItem } from '../../../lib/registry';
import { CATALOG_CATEGORY_ORDER } from '../../../lib/catalog.generated';
import { BlockCard } from '../../../_components/BlockCard';
import { CategoryFilter } from '../../../_components/CategoryFilter';

interface CatalogClientProps {
  items: CatalogItem[];
  categories: string[];
}

export function CatalogClient({ items, categories }: CatalogClientProps) {
  const [active, setActive] = React.useState('all');

  const visible = (
    active === 'all' ? items : items.filter((i) => i.categories?.[0] === active)
  ).slice().sort((a, b) => {
    const pa = CATALOG_CATEGORY_ORDER[a.categories?.[0] ?? ''] ?? 99;
    const pb = CATALOG_CATEGORY_ORDER[b.categories?.[0] ?? ''] ?? 99;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
  });

  return (
    <div className="p1-catalog-client">
      <CategoryFilter
        categories={categories}
        active={active}
        onChange={setActive}
      />
      <div className="p1-block-grid">
        {visible.map((item) => (
          <BlockCard key={item.name} item={item} />
        ))}
      </div>
    </div>
  );
}
