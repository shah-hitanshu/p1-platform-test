import { loadCatalog } from '../../lib/registry';
import { CatalogClient } from './_components/CatalogClient';

export default function CatalogPage() {
  const catalog = loadCatalog();
  const categories = Object.keys(catalog.byCategory).sort();

  return (
    <>
      <div className="p1-catalog-intro">
        <h1>P1 Components</h1>
        <p>
          Install any P1 component with the CLI — {catalog.items.length} components available.
        </p>
        <div className="p1-install-commands">
          <div className="p1-install-commands__row">
            <span className="p1-install-commands__label">ONE</span>
            <code className="p1-install-commands__code">pnpm dlx shadcn@latest add @p1/&lt;name&gt;</code>
          </div>
          <div className="p1-install-commands__row">
            <span className="p1-install-commands__label">ALL</span>
            <code className="p1-install-commands__code">pnpm dlx shadcn@latest add @p1/base</code>
          </div>
        </div>
      </div>
      <CatalogClient items={catalog.items} categories={categories} />
    </>
  );
}
