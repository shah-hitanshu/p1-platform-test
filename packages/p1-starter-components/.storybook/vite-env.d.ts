// Augments ImportMeta for Vite-specific APIs used in Storybook preview.
// Vite is not a direct devDependency of this package, so we declare the
// subset we actually use rather than pulling in the full vite/client types.
interface ImportMeta {
  glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>;
}
