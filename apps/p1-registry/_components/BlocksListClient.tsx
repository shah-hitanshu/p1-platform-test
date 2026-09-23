'use client';
import * as React from 'react';
import { Grid2x2, List, Search } from 'lucide-react';
import type { CatalogItem } from '../lib/registry';
import { CATALOG_CATEGORY_ORDER } from '../lib/catalog.generated';
import { categoryName } from '../lib/categories';
import { CategorySidebar } from './CategorySidebar';
import { BlockGridCard } from './BlockGridCard';
import { BlockListRow } from './BlockListRow';

interface BlocksListClientProps {
  items: CatalogItem[];
  initialCategory: string;
}

export function BlocksListClient({ items, initialCategory }: BlocksListClientProps) {
  const [category, setCategory] = React.useState(initialCategory);
  const [query, setQuery] = React.useState('');
  const [mode, setMode] = React.useState<'grid' | 'list'>('grid');

  const counts = React.useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of items) {
      const cat = item.categories?.[0] ?? 'other';
      result[cat] = (result[cat] ?? 0) + 1;
    }
    return result;
  }, [items]);

  const filtered = items
    .filter((item) => category === 'all' || item.categories?.[0] === category)
    .filter((item) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        (item.title ?? '').toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q)
      );
    })
    .slice()
    .sort((a, b) => {
      const pa = CATALOG_CATEGORY_ORDER[a.categories?.[0] ?? ''] ?? 99;
      const pb = CATALOG_CATEGORY_ORDER[b.categories?.[0] ?? ''] ?? 99;
      return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
    });

  const listTitle = category === 'all' ? 'P1 Blocks' : categoryName(category);

  return (
    <div className="p1-list-layout">
      <CategorySidebar active={category} onChange={setCategory} counts={counts} />

      <div className="p1-list-main">
        <div className="p1-list-main__head">
          <div className="p1-list-main__title-group">
            <h1>{listTitle}</h1>
            <span className="p1-list-main__count">
              {filtered.length} {filtered.length === 1 ? 'component' : 'components'}
            </span>
          </div>
          <div className="p1-list-main__tools">
            <div className="p1-view-toggle">
              <button
                className="p1-view-toggle__btn"
                data-active={mode === 'grid' ? 'true' : undefined}
                onClick={() => setMode('grid')}
                type="button"
                aria-label="Grid view"
              >
                <Grid2x2 aria-hidden="true" />
              </button>
              <button
                className="p1-view-toggle__btn"
                data-active={mode === 'list' ? 'true' : undefined}
                onClick={() => setMode('list')}
                type="button"
                aria-label="List view"
              >
                <List aria-hidden="true" />
              </button>
            </div>
            <div className="p1-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Search components"
                aria-label="Search components"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p1-list-empty">No components match &ldquo;{query}&rdquo;.</div>
        ) : mode === 'grid' ? (
          <div className="p1-block-grid">
            {filtered.map((item) => (
              <BlockGridCard key={item.name} item={item} />
            ))}
          </div>
        ) : (
          <div className="p1-block-list">
            {filtered.map((item) => (
              <BlockListRow key={item.name} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
