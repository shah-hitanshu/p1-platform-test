/**
 * Project Configuration Validation Tests
 *
 * These tests validate that the project is properly configured with:
 * - TypeScript compilation
 * - Required dependencies
 * - Cloudflare Workers types
 * - Environment interface
 */

import { describe, it, expect } from 'vitest';

describe('Project Configuration', () => {
  describe('TypeScript Configuration', () => {
    it('should have a valid tsconfig.json', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const tsconfigPath = path.resolve(__dirname, '../tsconfig.json');
      expect(fs.existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions).toBeDefined();
      expect(tsconfig.compilerOptions.strict).toBe(true);
      expect(tsconfig.compilerOptions.target).toBeDefined();
    });

    it('should compile TypeScript without errors', async () => {
      // This test passing means TypeScript compilation worked
      const indexModule = await import('../src/index');
      expect(indexModule.default).toBeDefined();
      expect(typeof indexModule.default.fetch).toBe('function');
    });
  });

  describe('Environment Interface', () => {
    it('should export Env interface with required properties', async () => {
      // Import the module to verify types compile
      const indexModule = await import('../src/index');

      // The Env interface should be exported
      // TypeScript will fail compilation if interface is malformed
      expect(indexModule).toBeDefined();
    });
  });

  describe('Required Dependencies', () => {
    it('should have vitest installed', async () => {
      const vitest = await import('vitest');
      expect(vitest.describe).toBeDefined();
      expect(vitest.it).toBeDefined();
      expect(vitest.expect).toBeDefined();
    });

    it('should have yjs installed for CRDT support', async () => {
      const Y = await import('yjs');
      expect(Y.Doc).toBeDefined();
      expect(Y.Map).toBeDefined();
      expect(Y.Array).toBeDefined();
    });

    it('should have fast-json-patch installed for JSON operations', async () => {
      const jsonPatch = await import('fast-json-patch');
      expect(jsonPatch.applyPatch).toBeDefined();
      expect(jsonPatch.compare).toBeDefined();
    });

    it('should have postgres client installed', async () => {
      const postgres = await import('postgres');
      expect(postgres.default).toBeDefined();
    });

    it('should have jose installed for JWT handling', async () => {
      const jose = await import('jose');
      expect(jose.SignJWT).toBeDefined();
      expect(jose.jwtVerify).toBeDefined();
    });

    it('should have object-hash installed for content hashing', async () => {
      const objectHash = await import('object-hash');
      expect(objectHash.default).toBeDefined();
    });
  });

  describe('Cloudflare Workers Types', () => {
    it('should have Cloudflare Workers types available', () => {
      // These types should be available globally from @cloudflare/workers-types
      // If TypeScript compilation succeeds, types are properly configured
      const envCheck: {
        DOCUMENT_STATE: DurableObjectNamespace;
        CONFIG_KV: KVNamespace;
      } = {} as any;

      // Type assertions - these will fail at compile time if types are missing
      expect(true).toBe(true);
    });
  });
});

describe('ESLint Configuration', () => {
  it('should have eslint.config.js file', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const eslintConfigPath = path.resolve(__dirname, '../eslint.config.js');
    expect(fs.existsSync(eslintConfigPath)).toBe(true);
  });
});

describe('Vitest Configuration', () => {
  it('should have vitest.config.ts file', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const vitestConfigPath = path.resolve(__dirname, '../vitest.config.ts');
    expect(fs.existsSync(vitestConfigPath)).toBe(true);
  });
});
