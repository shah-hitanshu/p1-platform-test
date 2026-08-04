/**
 * Registers jest-dom's matcher types (`toBeInTheDocument`, `toHaveAttribute`, …)
 * for every test file in the program.
 *
 * The matchers are installed at runtime by the setup files, which the editor's
 * language server never loads — so without this, every `toBeInTheDocument()` in
 * the suite is a red squiggle that no CI step catches.
 *
 * Two things about `tsconfig.test.json` are worth knowing before editing it,
 * since JSON can't hold the explanation itself:
 *
 * - The augmentation lives here rather than in `compilerOptions.types`, because
 *   `types` *replaces* default @types resolution instead of adding to it. Setting
 *   it strips `@types/react` from transitively-imported sources and invents ~90
 *   errors in src/.
 * - Its `include` covers `src` declaration files so the ambient CSS-module and
 *   PDS declarations are in the program. Without them, every `*.module.css`
 *   import in a component a test pulls in reports TS2307.
 * - `rootDir` is widened off the build config's `./src` because `tests/` sits
 *   outside it. Harmless under `noEmit`.
 */

import '@testing-library/jest-dom/vitest';
