'use client';
import { getBlockConfig } from '../lib/preview-map';

interface PreviewRendererProps {
  name: string;
}

export function PreviewRenderer({ name }: PreviewRendererProps) {
  const block = getBlockConfig(name);

  if (!block) {
    return <div style={{ padding: '2rem', color: '#888' }}>Block &quot;{name}&quot; not found.</div>;
  }

  const Render = block.render;
  return <Render {...(block.defaultProps as Record<string, unknown>)} />;
}
