import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..');

describe('p1-next-sdk file structure', () => {
  const expectedFiles = [
    'index.ts',
    'handler.ts',
    'handler-actions.ts',
    'pages-handler.tsx',
    'P1NextRouterProvider.tsx',
    'routes/page-data.ts',
    'routes/publish.ts',
    'routes/resolve-preview.ts',
    'routes/preview-meta.ts',
    'routes/remote-datasources-api.ts',
    'routes/editor-context.ts',
  ];

  for (const file of expectedFiles) {
    it(`includes ${file}`, () => {
      expect(existsSync(resolve(srcDir, file))).toBe(true);
    });
  }

  it('P1NextRouterProvider imports from @pantheon-systems/puck-css', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(srcDir, 'P1NextRouterProvider.tsx'), 'utf-8');
    expect(content).toContain('@pantheon-systems/puck-css');
    expect(content).toContain('P1RouterContext');
    expect(content).toContain('next/navigation');
  });

  it('handler imports from @pantheon-systems/puck-css/server', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(srcDir, 'handler.ts'), 'utf-8');
    expect(content).toContain('@pantheon-systems/puck-css/server');
    expect(content).toContain('next/server');
  });
});
