import { PreviewRenderer } from '../../../../_components/PreviewRenderer';
import { previewNames } from '../../../../lib/preview-names';

export function generateStaticParams() {
  return previewNames.map((name) => ({ name }));
}

// params is a Promise in Next.js 15+
export default async function PreviewPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <PreviewRenderer name={name} />;
}
