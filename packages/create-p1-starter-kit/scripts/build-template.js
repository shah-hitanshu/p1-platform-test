import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const templateSource = path.join(repoRoot, 'apps/p1-starter');
const templateDest = path.join(__dirname, '../template');

// Directories and files to skip when copying
const SKIP_PATTERNS = new Set([
  'node_modules',
  '.next',
  'dist',
  '.turbo',
  '.env.local',
  '.env',
  'coverage',
  'test-results',
  'playwright-report',
  '.DS_Store',
  'README.md',
]);

function shouldSkip(name) {
  return SKIP_PATTERNS.has(name);
}

function copyRecursive(src, dest, rootDest) {
  if (!rootDest) {
    rootDest = path.resolve(dest);
  }

  const resolvedDest = path.resolve(dest);
  if (!resolvedDest.startsWith(rootDest)) {
    throw new Error(`Path traversal detected: ${dest} is outside target directory`);
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldSkip(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    const resolvedDestPath = path.resolve(destPath);
    if (!resolvedDestPath.startsWith(rootDest)) {
      throw new Error(`Path traversal detected: ${entry.name} attempts to escape target directory`);
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, rootDest);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getPublishedVersion(packageName) {
  const pkgPath = path.join(repoRoot, 'packages', packageName.replace('@pantheon-systems/', ''), 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch (error) {
    throw new Error(`Failed to read version for ${packageName}: ${error.message}`);
  }
}

function transformPackageJson(destPath) {
  const pkgPath = path.join(destPath, 'package.json');
  let pkg;

  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to parse package.json: ${error.message}`);
  }

  pkg.name = 'PLACEHOLDER_PROJECT_NAME';
  // Monorepo-internal script (run via the repo root's dev:stack); not for scaffolded apps.
  delete pkg.scripts['dev:stack'];
  pkg.version = '0.1.0';
  delete pkg.private;

  // Replace workspace: deps with published versions
  const pantheonPackages = ['css-client', 'p1-next-sdk', 'puck-css'];
  for (const pkgName of pantheonPackages) {
    const fullName = `@pantheon-systems/${pkgName}`;
    if (pkg.dependencies && pkg.dependencies[fullName]) {
      const version = getPublishedVersion(fullName);
      pkg.dependencies[fullName] = `^${version}`;
      console.log(`  ${fullName}: workspace:* → ^${version}`);
    }
  }

  // Replace shared eslint-config with its actual dependencies
  if (pkg.devDependencies) {
    delete pkg.devDependencies['@pantheon-systems/eslint-config'];
    const eslintConfigPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/eslint-config/package.json'), 'utf-8')
    );
    Object.assign(pkg.devDependencies, eslintConfigPkg.dependencies);
    console.log('  Replaced @pantheon-systems/eslint-config with standalone eslint deps');
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function rewriteEslintConfig(destPath) {
  const configPath = path.join(destPath, 'eslint.config.js');
  const eslintConfigDir = path.join(repoRoot, 'packages/eslint-config');
  const baseConfig = fs.readFileSync(path.join(eslintConfigDir, 'base.js'), 'utf-8');
  const reactConfig = fs.readFileSync(path.join(eslintConfigDir, 'react.js'), 'utf-8');
  const prettierConfig = fs.readFileSync(path.join(eslintConfigDir, 'prettier.js'), 'utf-8');

  // Collect all external imports (dedup by specifier), skip relative imports
  const importMap = new Map();
  for (const source of [baseConfig, reactConfig, prettierConfig]) {
    for (const match of source.matchAll(/^import\s+(\w+)\s+from\s+'([^']+)';$/gm)) {
      if (!match[2].startsWith('.')) {
        importMap.set(match[2], match[1]);
      }
    }
  }

  const imports = Array.from(importMap.entries())
    .map(([mod, name]) => `import ${name} from '${mod}';`)
    .join('\n');

  // base.js: strip imports, unwrap `export default tseslint.config(` ... `);`
  // to get the inner config entries
  const baseEntries = baseConfig
    .replace(/^import\s+.*;\s*\n/gm, '')
    .replace(/^\s*\n/gm, '')
    .replace(/^export\s+default\s+tseslint\.config\(\n?/m, '')
    .replace(/\);\s*$/, '')
    .trim();

  // react.js: strip imports, unwrap `export default [` ... `];`
  // and remove `...baseConfig,` since base is already included
  const reactEntries = reactConfig
    .replace(/^import\s+.*;\s*\n/gm, '')
    .replace(/^\s*\n/gm, '')
    .replace(/^export\s+default\s+\[\s*\n?/m, '')
    .replace(/\s*\];\s*$/, '')
    .replace(/\s*\.\.\.baseConfig,?\s*\n?/g, '')
    .trim();

  // prettier.js: strip imports, unwrap `export default [` ... `];`
  const prettierEntries = prettierConfig
    .replace(/^import\s+.*;\s*\n/gm, '')
    .replace(/^\s*\n/gm, '')
    .replace(/^export\s+default\s+\[\s*\n?/m, '')
    .replace(/\s*\];\s*$/, '')
    .trim();

  // Combine: ensure no trailing commas before next section
  const addTrailingComma = (s) => s.replace(/,?\s*$/, ',');

  const config = `${imports}

export default tseslint.config(
  ${addTrailingComma(baseEntries)}
  ${addTrailingComma(reactEntries)}
  ${prettierEntries},
);
`;

  // Validate the generated config has the expected structure
  const errors = [];
  if (!config.includes('export default tseslint.config(')) {
    errors.push('missing export default tseslint.config(');
  }
  if (!config.includes("import tseslint from 'typescript-eslint'")) {
    errors.push('missing typescript-eslint import');
  }
  if (!config.includes("import eslint from '@eslint/js'")) {
    errors.push('missing @eslint/js import');
  }
  if ((config.match(/,,/g) || []).length > 0) {
    errors.push('contains double commas (,,)');
  }
  if (errors.length > 0) {
    throw new Error(
      `Generated eslint.config.js failed validation:\n  - ${errors.join('\n  - ')}\n` +
      'The shared eslint-config source format may have changed. Update rewriteEslintConfig() accordingly.'
    );
  }

  fs.writeFileSync(configPath, config);
  console.log('  Rewrote eslint.config.js to self-contained config');
}

console.log('Building template from apps/p1-starter...');

if (!fs.existsSync(templateSource)) {
  console.error(`Error: Template source not found at ${templateSource}`);
  process.exit(1);
}

if (fs.existsSync(templateDest)) {
  console.log('Removing existing template directory...');
  fs.rmSync(templateDest, { recursive: true });
}

console.log('Copying template files...');
copyRecursive(templateSource, templateDest);

console.log('Transforming package.json...');
transformPackageJson(templateDest);

console.log('Rewriting eslint config...');
rewriteEslintConfig(templateDest);

console.log('Generating pnpm-workspace.yaml...');
const workspaceYaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf-8');
const allowBuildsMatch = workspaceYaml.match(/allowBuilds:\n((?:\s+\S+:\s+true\n?)+)/);
if (allowBuildsMatch) {
  fs.writeFileSync(
    path.join(templateDest, 'pnpm-workspace.yaml'),
    `allowBuilds:\n${allowBuildsMatch[1]}`
  );
  const pkgs = [...allowBuildsMatch[1].matchAll(/\s+(\S+):\s+true/g)].map(m => m[1]);
  console.log(`  allowBuilds: ${pkgs.join(', ')}`);
}

console.log('✓ Template built successfully from apps/p1-starter');
