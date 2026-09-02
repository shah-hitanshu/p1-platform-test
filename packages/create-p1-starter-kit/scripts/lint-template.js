// Guards the built template against the three ways monorepo-shaped code has
// reached customer scaffolds: a relative path that climbs out of the project, an
// unresolved workspace specifier, and an import of a package the scaffold never
// installs. Each is a class of bug that installs and builds fine in this repo and
// only fails on a customer's machine, so nothing else in CI sees it.
//
// Deliberately a denylist over the generated tree rather than a transform: the
// past defects came from silently rewriting files, so this fails loudly instead.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const defaultTemplate = path.join(__dirname, '../template');

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css']);
const TEXT_EXTENSIONS = new Set([...CODE_EXTENSIONS, '.md', '.yaml', '.yml', '.example']);
// Carry no extension but are still text the rules apply to.
const TEXT_FILENAMES = new Set(['gitignore', '.env.example']);

const QUOTED = /(?<!\w)(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const PANTHEON_SPECIFIER = /^@pantheon-systems\/[^/]+/;

function isTextFile(name) {
  return TEXT_FILENAMES.has(name) || TEXT_EXTENSIONS.has(path.extname(name));
}

function isCodeFile(name) {
  return CODE_EXTENSIONS.has(path.extname(name));
}

function walk(dir, root = dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, root, files);
    } else if (isTextFile(entry.name)) {
      files.push(path.relative(root, full));
    }
  }
  return files;
}

// Every quoted string in the file, with the line it sits on. Regex rather than a
// parser because the tree spans TS, JSON, CSS and YAML; a specifier that slips
// past the quote matcher is a missed finding, never a false one.
function quotedStrings(source) {
  const found = [];
  source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(QUOTED)) {
      found.push({ value: match[2], line: index + 1 });
    }
  });
  return found;
}

function privateWorkspacePackages() {
  const dir = path.join(repoRoot, 'packages');
  const names = new Map();

  if (!fs.existsSync(dir)) return names;

  for (const entry of fs.readdirSync(dir)) {
    const manifest = path.join(dir, entry, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    if (pkg.private) names.set(pkg.name, `packages/${entry} is private and never published`);
  }

  return names;
}

function declaredDependencies(templateDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8'));
  return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
}

// A relative path is only meaningful against the file holding it, so each is
// resolved from that file's directory. Anything landing outside the template root
// resolves to nothing once the scaffold is a standalone project.
function checkProjectEscapes(file, strings, violations) {
  for (const { value, line } of strings) {
    if (!value.startsWith('./') && !value.startsWith('../') && value !== '..') continue;

    const resolved = path.resolve(path.dirname(path.join('/template', file)), value);
    if (resolved === '/template' || resolved.startsWith('/template/')) continue;

    violations.push({
      file,
      line,
      rule: 'escapes-project-root',
      message:
        `"${value}" resolves outside the project. It points into the monorepo, ` +
        'so a scaffolded project resolves nothing.',
    });
  }
}

function checkWorkspaceSpecifiers(file, source, violations) {
  source.split('\n').forEach((text, index) => {
    if (!text.includes('workspace:')) return;
    violations.push({
      file,
      line: index + 1,
      rule: 'workspace-specifier',
      message:
        'unresolved "workspace:" specifier. Only this monorepo can resolve it; ' +
        'a scaffolded install fails outright.',
    });
  });
}

function checkInternalPackages(file, strings, declared, privatePackages, violations) {
  for (const { value, line } of strings) {
    const match = value.match(PANTHEON_SPECIFIER);
    if (!match) continue;

    const name = match[0];
    if (declared.has(name)) continue;

    const reason = privatePackages.get(name) ?? 'it is not in the template\'s package.json';
    violations.push({
      file,
      line,
      rule: 'undeclared-internal-package',
      message: `imports ${name}, but ${reason}, so a scaffold never installs it.`,
    });
  }
}

export function lintTemplate(templateDir = defaultTemplate) {
  if (!fs.existsSync(templateDir)) {
    throw new Error(`No built template at ${templateDir}. Run build-template.js first.`);
  }

  const declared = declaredDependencies(templateDir);
  const privatePackages = privateWorkspacePackages();
  const violations = [];

  for (const file of walk(templateDir)) {
    const source = fs.readFileSync(path.join(templateDir, file), 'utf-8');

    checkWorkspaceSpecifiers(file, source, violations);

    // The remaining rules read import specifiers, which only code files have.
    // Prose naming a package or a path is documentation, not a broken reference.
    if (!isCodeFile(file)) continue;

    const strings = quotedStrings(source);
    checkProjectEscapes(file, strings, violations);
    checkInternalPackages(file, strings, declared, privatePackages, violations);
  }

  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultTemplate;
  let violations;

  try {
    violations = lintTemplate(target);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} problem(s) in the built template:\n`);
    for (const { file, line, rule, message } of violations) {
      console.error(`  ${file}:${line}  [${rule}]  ${message}`);
    }
    console.error(
      '\nFix the source in apps/p1-starter (or the build step that produces the file).'
    );
    process.exit(1);
  }

  console.log('✓ Built template is free of monorepo paths, workspace specifiers, and internal imports');
}
