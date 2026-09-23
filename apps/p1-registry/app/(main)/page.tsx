import Link from 'next/link';
import { loadCatalog } from '../../lib/registry';
import { CATEGORIES } from '../../lib/categories';
import { CopyCommand } from '../../_components/CopyCommand';

export default function HomePage() {
  const catalog = loadCatalog();

  return (
    <>
      <section className="p1-hero">
        <div className="p1-hero__text">
          <h1>P1 Block Library</h1>
          <p>
            Production ready blocks for building marketing pages fast. Installable with a
            single command.
          </p>
          <CopyCommand
            command="pnpm dlx shadcn@latest add @p1/base"
            className="p1-hero__cmd p1-cmd-box--full"
            label="Copy install command"
          />
          <div className="p1-hero__actions">
            <Link href="/blocks" className="p1-btn p1-btn--brand">
              Browse blocks
            </Link>
            <Link href="/documentation" className="p1-btn p1-btn--secondary">
              See how it works
            </Link>
          </div>
        </div>
        <div className="p1-hero__media">
          <img src="/images/hero-illustration.webp" alt="" />
        </div>
      </section>

      <section className="p1-home-section" id="categories">
        <h2>Find blocks by job.</h2>
        <div className="p1-category-grid">
          {CATEGORIES.map((cat) => {
            const count = catalog.byCategory[cat.id]?.length ?? 0;
            const Icon = cat.icon;
            return (
              <Link
                key={cat.id}
                href={`/blocks?category=${cat.id}`}
                className="p1-category-card"
              >
                <div className="p1-category-card__head">
                  <Icon aria-hidden="true" />
                  <span className="p1-category-card__name">{cat.name}</span>
                </div>
                <p className="p1-category-card__desc">{cat.description}</p>
                <span className="p1-category-card__count">
                  {count} {count === 1 ? 'component' : 'components'}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
