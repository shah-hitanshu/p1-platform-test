import type { NextConfig } from 'next';

// Static export. The catalog is content and `shadcn build` already wrote the
// registry JSON into public/r, so nothing here needs a running process — the
// version tree aliases by directory copy at build time, not by routing.
// Dynamic routes (loadRegistryItem for the configurator) would need a server;
// that is Future work, and spec D21 records the migration path.
const config: NextConfig = { output: 'export', images: { unoptimized: true } };

export default config;
