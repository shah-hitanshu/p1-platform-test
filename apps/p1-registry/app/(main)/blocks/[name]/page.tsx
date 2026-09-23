import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadCatalog, getCatalogItem, getComponentSource } from '../../../../lib/registry';
import { blockProps } from '../../../../lib/block-props.generated';
import { previewNames } from '../../../../lib/preview-names';
import { registrationSnippet } from '../../../../lib/registration-snippet';
import { categoryName } from '../../../../lib/categories';
import { DetailTabs } from '../../../../_components/DetailTabs';
import { DetailSidebar } from '../../../../_components/DetailSidebar';

export function generateStaticParams() {
  return loadCatalog().items.map((item) => ({ name: item.name }));
}

interface DetailPageProps {
  params: Promise<{ name: string }>;
}

export default async function BlockDetailPage({ params }: DetailPageProps) {
  const { name } = await params;
  const catalog = loadCatalog();
  const item = getCatalogItem(name);
  if (!item) notFound();

  const category = item.categories?.[0];
  const related = category
    ? catalog.byCategory[category]?.find((i) => i.name !== item.name)
    : undefined;

  const hasPreview = previewNames.includes(item.name);
  const props = blockProps[item.name] ?? [];
  const code = getComponentSource(item.name);
  const registerDocs = registrationSnippet(item.docs);
  const agentPrompt = `Add the P1 ${item.title ?? item.name} block to this project and register it in the Puck config.`;

  return (
    <div className="p1-page">
      <div className="p1-breadcrumb">
        <Link href="/blocks">Components</Link>
        <span>›</span>
        {category && <Link href={`/blocks?category=${category}`}>{categoryName(category)}</Link>}
        <span>›</span>
        <span className="p1-breadcrumb__current">{item.title ?? item.name}</span>
      </div>

      <div className="p1-detail-head">
        <h1>{item.title ?? item.name}</h1>
        {category && (
          <span className="p1-tag" data-category={category}>
            {category}
          </span>
        )}
      </div>
      {item.description && <p className="p1-detail-desc">{item.description}</p>}

      <div className="p1-detail-layout">
        <div className="p1-detail-main">
          <DetailTabs
            hasPreview={hasPreview}
            previewSrc={`/preview/${item.name}`}
            title={item.title ?? item.name}
            code={code}
          />

          {props.length > 0 && (
            <>
              <h2>Props</h2>
              <table className="p1-props-table">
                <thead>
                  <tr>
                    <th>Prop</th>
                    <th>Type</th>
                    <th>Default</th>
                  </tr>
                </thead>
                <tbody>
                  {props.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td data-muted>{p.type}</td>
                      <td data-muted>{p.default}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <DetailSidebar
          installCommand={item.addCommand}
          registerDocs={registerDocs}
          agentPrompt={agentPrompt}
          related={related ? { name: related.name, title: related.title } : undefined}
        />
      </div>
    </div>
  );
}
