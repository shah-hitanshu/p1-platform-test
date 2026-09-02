'use client';

import type React from 'react';
import { previewComponents } from '../lib/catalog.generated';

interface PreviewRendererProps {
  name: string;
}

export function PreviewRenderer({ name }: PreviewRendererProps) {
  const Block: React.ComponentType | undefined = previewComponents[name];

  if (!Block) {
    return <div style={{ padding: '2rem', color: '#888' }}>Block &quot;{name}&quot; not found.</div>;
  }

  return <Block />;
}
