import { loadCatalog } from '../../lib/registry';
import { CatalogClient } from './_components/CatalogClient';

export default function CatalogPage() {
  const catalog = loadCatalog();
  const categories = Object.keys(catalog.byCategory).sort();

  return (
    <>
      <div className="p1-catalog-intro">
        <h1>P1 Blocks</h1>
        <p>
          Marketing and editorial Puck blocks for Pantheon Content Publisher.
          Install any block with <code>pnpm dlx shadcn@latest add @p1/&lt;name&gt;</code>,
          or add all 29 non-collider blocks at once with{' '}
          <code>pnpm dlx shadcn@latest add @p1/base</code>.
        </p>
      </div>
      <CatalogClient items={catalog.items} categories={categories} />
    </>
  );
}
