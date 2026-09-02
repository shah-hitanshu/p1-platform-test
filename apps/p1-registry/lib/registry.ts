import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RegistryItem {
  name: string;
  type: string;
  title?: string;
  description?: string;
  categories?: string[];
  files?: { path: string; type: string; target?: string }[];
  docs?: string;
}

export interface CatalogItem extends RegistryItem {
  addCommand: string;
}

export interface Catalog {
  items: CatalogItem[];
  byCategory: Record<string, CatalogItem[]>;
}

export function loadCatalog(registryDir?: string): Catalog {
  const dir = registryDir ?? join(process.cwd(), 'public', 'r');
  const indexPath = join(dir, 'registry.json');

  if (!existsSync(indexPath)) {
    throw new Error(
      `Registry index not found at ${indexPath}. Run registry:build first.`,
    );
  }

  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    items: RegistryItem[];
  };

  // Catalog shows blocks and theme items only. Internal shared libs (registry:lib)
  // and the base meta-package are dependencies, not user-installable items.
  const SHOW_TYPES = new Set(['registry:block']);
  const items: CatalogItem[] = index.items
    .filter((i) => SHOW_TYPES.has(i.type))
    .map((i) => ({
      ...i,
      addCommand: `pnpm dlx shadcn@latest add @p1/${i.name}`,
    }));

  const byCategory: Record<string, CatalogItem[]> = {};
  for (const item of items) {
    const cat = item.categories?.[0] ?? 'other';
    (byCategory[cat] ??= []).push(item);
  }

  return { items, byCategory };
}
