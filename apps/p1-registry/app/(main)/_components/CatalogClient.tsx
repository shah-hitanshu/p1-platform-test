'use client';
import * as React from 'react';
import type { CatalogItem } from '../../../lib/registry';
import { BlockCard } from '../../../_components/BlockCard';
import { CategoryFilter } from '../../../_components/CategoryFilter';

interface CatalogClientProps {
  items: CatalogItem[];
  categories: string[];
}

export function CatalogClient({ items, categories }: CatalogClientProps) {
  const [active, setActive] = React.useState('all');

  const visible =
    active === 'all' ? items : items.filter((i) => i.categories?.[0] === active);

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
