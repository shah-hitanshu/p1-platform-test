import type { NextConfig } from 'next';

// Static export — catalog is content-only, no server needed.
// Preview pages render block components via a separate root layout (route group).
// Turbopack resolves @/registry/* via tsconfig paths to the blocks package source.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Process workspace package source so CSS and TSX imports from blocks bundle correctly.
  transpilePackages: ['@pantheon-systems/p1-starter-components'],
};

export default config;
