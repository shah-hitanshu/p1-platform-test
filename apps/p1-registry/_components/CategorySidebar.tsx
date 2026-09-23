import { CATEGORIES } from '../lib/categories';

interface CategorySidebarProps {
  active: string;
  onChange: (id: string) => void;
  counts: Record<string, number>;
}

export function CategorySidebar({ active, onChange, counts }: CategorySidebarProps) {
  return (
    <div className="p1-list-sidebar">
      <div className="p1-list-sidebar__label">Categories</div>
      <div className="p1-list-sidebar__list">
        <button
          className="p1-list-sidebar__item"
          data-active={active === 'all' ? 'true' : undefined}
          onClick={() => onChange('all')}
          type="button"
        >
          All blocks
        </button>
        {CATEGORIES.filter((cat) => (counts[cat.id] ?? 0) > 0).map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              className="p1-list-sidebar__item"
              data-active={active === cat.id ? 'true' : undefined}
              onClick={() => onChange(cat.id)}
              type="button"
            >
              <Icon aria-hidden="true" />
              {cat.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
