import { getBlockConfig, previewNames } from '../../../../lib/preview-map';

export function generateStaticParams() {
  return previewNames.map((name) => ({ name }));
}

export default function PreviewPage({ params }: { params: { name: string } }) {
  const block = getBlockConfig(params.name);

  if (!block) {
    return <div style={{ padding: '2rem', color: '#888' }}>Block &quot;{params.name}&quot; not found.</div>;
  }

  const Render = block.render as React.ComponentType<Record<string, unknown>>;
  return <Render {...(block.defaultProps as Record<string, unknown>)} />;
}
