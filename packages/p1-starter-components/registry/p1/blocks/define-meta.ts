type BlockMeta = {
  title: string;
  description: string;
  categories: readonly string[];
  /**
   * false = Storybook only — block is excluded from the catalog and the shadcn
   * registry. Use while a block is in development. Omit or set true to publish.
   */
  published?: boolean;
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
    published: true,
    ...meta,
  } as const;
}

/** Placeholder art for block defaults: a grey field with a diagonal, inline as
 *  a data URI so nothing loads off the network. Authors swap in a real image. */
export function wireframe(w: number, h: number) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#f1f1f3"/>` +
    `<path d="M0 ${h}L${w} 0" stroke="#c8c8ce" stroke-width="${Math.round(Math.max(w, h) * 0.07)}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
