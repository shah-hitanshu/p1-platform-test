type BlockMeta = {
  title: string;
  description: string;
  categories: readonly string[];
  /** Additional internal registry deps beyond @p1/tokens. Common values:
   *  '@p1/internal-btn'   — uses the btn primitive
   *  '@p1/internal-icons' — uses SVG icons
   *  '@p1/internal-rich'  — uses the rich-text field helper
   *  '@p1/internal-form'  — uses form/input primitives
   */
  registryDependencies?: string[];
  /** npm packages beyond @puckeditor/core. Rarely needed. */
  dependencies?: string[];
};

export function defineMeta(meta: BlockMeta) {
  return {
    dependencies: ['@puckeditor/core'],
    registryDependencies: ['@p1/tokens'],
    ...meta,
  } as const;
}
