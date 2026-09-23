import {
  BookOpen,
  FileText,
  Gem,
  Globe,
  Grip,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryMeta {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

// Curated copy for the catalog's "find blocks by job" grid and the blocks-list
// sidebar. Category ids match what each block's meta.categories[0] resolves
// to (see CATALOG_CATEGORY_ORDER in catalog.generated.tsx) — component counts
// are computed from the real catalog, never hardcoded here.
export const CATEGORIES: CategoryMeta[] = [
  { id: 'attention', name: 'Attention', description: 'Grab focus the moment a page loads.', icon: Megaphone },
  { id: 'content', name: 'Content', description: 'Long-form and editorial layouts.', icon: FileText },
  { id: 'convert', name: 'Convert', description: 'Pricing and calls to action.', icon: Target },
  { id: 'editorial', name: 'Editorial', description: 'Publishing-style compositions.', icon: BookOpen },
  { id: 'global', name: 'Global', description: 'Headers, footers, and nav.', icon: Globe },
  { id: 'layout', name: 'Layout', description: 'Structural building blocks.', icon: Grip },
  { id: 'showcase', name: 'Showcase', description: 'Portfolios, galleries, work.', icon: Sparkles },
  { id: 'trust', name: 'Trust', description: 'Proof that reassures visitors.', icon: ShieldCheck },
  { id: 'value', name: 'Value', description: 'Explain benefits and process.', icon: Gem },
];

export const CATEGORY_META: Record<string, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export function categoryName(id: string): string {
  return CATEGORY_META[id]?.name ?? id.replace(/^./, (c) => c.toUpperCase());
}
