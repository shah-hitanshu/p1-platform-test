import Link from 'next/link';
import { loadCatalog } from '../../../lib/registry';
import { QuickChip } from '../../../_components/QuickChip';
import { BlocksListClient } from '../../../_components/BlocksListClient';

interface BlocksPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function BlocksPage({ searchParams }: BlocksPageProps) {
  const catalog = loadCatalog();
  const { category } = await searchParams;
  const initialCategory = category && catalog.byCategory[category] ? category : 'all';

  return (
    <div className="p1-page">
      <div className="p1-catalog-intro">
        <h1>P1 Blocks</h1>
        <p>
          Install any P1 component with the CLI. All components are using a theme that
          can be customized. See the <Link href="/theme">theme tokens</Link>.
        </p>
      </div>
      <div className="p1-quick-chips">
        <QuickChip label="One" command="pnpm dlx shadcn@latest add @p1/<name>" />
        <QuickChip label="All" command="pnpm dlx shadcn@latest add @p1/base" />
      </div>
      <BlocksListClient items={catalog.items} initialCategory={initialCategory} />
    </div>
  );
}
