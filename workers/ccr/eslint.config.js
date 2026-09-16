import { createWorkerConfig } from '@pantheon-systems/eslint-config/worker';
import testsConfig from '@pantheon-systems/eslint-config/tests';

// Transaction control is the scope's to issue: transaction() from src/db/scope
// owns the boundary, and a statement that opens or closes one behind its back
// leaves the scope describing a transaction that is no longer there.
const noRawTransactionControl = {
  selector: "Literal[value=/^\\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\\b/]",
  message: 'Transaction control belongs to transaction() from src/db/scope, not a raw statement.',
};

const noWorkersTypesImport = {
  name: '@cloudflare/workers-types',
  message:
    'These types are ambient globals (tsconfig "types"). Importing this package loads a duplicate 15k-line type universe and hangs tsserver/tsc. Use the global types directly.',
};

export default [
  ...createWorkerConfig({
    project: './tsconfig.eslint.json',
    tsconfigRootDir: import.meta.dirname,
    restrictWorkersTypes: true,
  }),
  ...testsConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportSpecifier[imported.name='installDatabase']",
          message:
            'installDatabase is the test fallback for db(). Production code opens a scope with runWithConnection.',
        },
        noRawTransactionControl,
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            noWorkersTypesImport,
            {
              name: 'postgres',
              message:
                'The driver belongs to the db layer. Reach the database through db() from src/db/scope.',
            },
          ],
        },
      ],
    },
  },
  {
    // The db layer is what holds the driver.
    files: ['src/db.ts', 'src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [noWorkersTypesImport] }],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', noRawTransactionControl],
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '**/*.js'],
  },
];
