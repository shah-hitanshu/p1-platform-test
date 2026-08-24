import type { CatalogItem } from '../lib/registry';
import { AddCommand } from './AddCommand';

interface BlockCardProps {
  item: CatalogItem;
}

export function BlockCard({ item }: BlockCardProps) {
  return (
    <article className="p1-block-card">
      <header className="p1-block-card__header">
        {item.categories?.[0] && (
          <span className="p1-block-card__tag">{item.categories[0]}</span>
        )}
        <h2 className="p1-block-card__title">{item.title ?? item.name}</h2>
        {item.description && (
          <p className="p1-block-card__desc">{item.description}</p>
        )}
      </header>
      <footer className="p1-block-card__footer">
        <AddCommand name={item.name} title={item.title ?? item.name} />
      </footer>
    </article>
  );
}
