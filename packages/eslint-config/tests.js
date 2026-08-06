/**
 * Test-file relaxations.
 *
 * Append this AFTER the base/react/worker layers so it wins. Each rule here is
 * off because the pattern it flags is idiomatic in tests, not debt — measured
 * against the repo on 2026-08-05, where 79% of no-non-null-assertion and 77% of
 * no-empty-function findings were in test files.
 *
 * Rules deliberately NOT relaxed: no-floating-promises and no-misused-promises
 * (an unawaited promise in a test is a silently passing test),
 * no-unnecessary-condition (it found real dead assertions), and no-unused-vars.
 */

export const TEST_FILES = [
  '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}',
  '**/tests/**/*.{js,jsx,mjs,cjs,ts,tsx}',
  '**/test/**/*.{js,jsx,mjs,cjs,ts,tsx}',
  '**/__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx}',
  '**/__mocks__/**/*.{js,jsx,mjs,cjs,ts,tsx}',
  '**/test-stubs/**/*.{js,jsx,mjs,cjs,ts,tsx}',
  '**/*.setup.{js,mjs,cjs,ts}',
];

export default [
  {
    files: TEST_FILES,
    rules: {
      // `x!` after a known-good arrange step asserts the fixture, it doesn't hide a bug.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `() => {}` is the entire point of a stub.
      '@typescript-eslint/no-empty-function': 'off',
      // Passing an unbound method to vi.spyOn / expect is the documented API.
      '@typescript-eslint/unbound-method': 'off',
      // Test helpers are read at the call site; annotating their returns is noise.
      '@typescript-eslint/explicit-function-return-type': 'off',
      // `async` with no await is how you satisfy an interface in a fake.
      '@typescript-eslint/require-await': 'off',
      // Mock payloads are structurally untyped by nature.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      // Stand-ins for `cloudflare:*` built-ins have to be classes to stand in
      // for classes, even with nothing in them.
      '@typescript-eslint/no-extraneous-class': 'off',
      // `vi.importActual<typeof import('mod')>('mod')` is vitest's documented
      // shape and cannot be hoisted to a top-level type import.
      '@typescript-eslint/consistent-type-imports': ['warn', { disallowTypeAnnotations: false }],
      // Inline fixtures and assertion chains run long. The formatter will own
      // line length once it lands; until then this is the only rule that would
      // force hand-wrapping code a formatter is about to rewrite.
      'max-len': 'off',
    },
  },
];
