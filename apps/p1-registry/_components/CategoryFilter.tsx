'use client';
import * as React from 'react';

interface CategoryFilterProps {
  categories: string[];
  active: string;
  onChange: (cat: string) => void;
}

export function CategoryFilter({ categories, active, onChange }: CategoryFilterProps) {
  return (
    <nav className="p1-cat-filter" aria-label="Filter by category">
      <button
        className="p1-cat-filter__btn"
        data-active={active === 'all' ? 'true' : undefined}
        onClick={() => onChange('all')}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          className="p1-cat-filter__btn"
          data-active={active === cat ? 'true' : undefined}
          onClick={() => onChange(cat)}
        >
          {cat}
        </button>
      ))}
    </nav>
  );
}
