import { createUsePuck } from '@puckeditor/core';

import { blockLabel, type OutlineConfig } from '../../editor/components/outlineTree.js';
import type { ThreadSubject } from './types.js';

const usePuckBlock = createUsePuck();

interface BlockLookup {
  getItemById?: (id: string) => { type: string } | undefined;
  config?: OutlineConfig;
}

/** Names a block the way the outline does. */
export function useBlockSubject(blockId: string): ThreadSubject {
  const label = usePuckBlock((s) => {
    const { getItemById, config } = s as unknown as BlockLookup;
    const type = getItemById?.(blockId)?.type;
    return type ? blockLabel(config ?? {}, type) : undefined;
  }) as string | undefined;

  return { label: label ?? 'Block', icon: 'grid2' };
}
