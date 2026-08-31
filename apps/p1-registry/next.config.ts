import type { NextConfig } from 'next';

// Pantheon builds and serves this app with `next build` + `next start`. Static
// export must stay off — next start refuses to run alongside it — so pages
// prerender to static HTML and public/r/*.json is served as plain static files.
const config: NextConfig = {
  images: { unoptimized: true },
  // Process workspace package source so CSS and TSX imports from blocks bundle correctly.
  transpilePackages: ['@pantheon-systems/p1-starter-components'],
};

export default config;
