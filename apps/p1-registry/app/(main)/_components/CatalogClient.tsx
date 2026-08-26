'use client';
import * as React from 'react';
import type { CatalogItem } from '../../../lib/registry';
import { BlockCard } from '../../../_components/BlockCard';
import { CategoryFilter } from '../../../_components/CategoryFilter';

interface CatalogClientProps {
  items: CatalogItem[];
  categories: string[];
}

// Visually rich blocks first, sparse/minimal ones last.
const DISPLAY_ORDER: Record<string, number> = {
  hero: 0,
  gallery: 1,
  'feature-media': 2,
  features: 3,
  'card-grid': 4,
  pricing: 5,
  'comparison-table': 6,
  faq: 7,
  steps: 8,
  'team-grid': 9,
  cta: 10,
  'lead-capture': 11,
  tabs: 12,
  footer: 13,
  header: 14,
  logos: 15,
  testimonial: 16,
  timeline: 17,
  accordion: 18,
  'article-header': 19,
  columns: 20,
  image: 21,
  stats: 22,
  container: 23,
  'rich-text': 24,
  list: 25,
  announcement: 26,
  button: 27,
  callout: 28,
  quote: 29,
  'pull-quote': 30,
  figure: 31,
  embed: 32,
  heading: 33,
  paragraph: 34,
  divider: 35,
  spacer: 36,
};

export function CatalogClient({ items, categories }: CatalogClientProps) {
  const [active, setActive] = React.useState('all');

  const visible = (
    active === 'all' ? items : items.filter((i) => i.categories?.[0] === active)
  ).slice().sort((a, b) => (DISPLAY_ORDER[a.name] ?? 99) - (DISPLAY_ORDER[b.name] ?? 99));

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
