import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getTemplatePath() {
  return path.join(__dirname, '..', 'template');
}

export function getScaffolderVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

// npm strips files named `.gitignore` from published tarballs, so the template
// ships it undotted (see scripts/build-template.js) and the name is restored here
// — before the CLI's initial `git add -A`.
const GITIGNORE_TEMPLATE_NAME = 'gitignore';
const PROJECT_NAME_PLACEHOLDER = 'PLACEHOLDER_PROJECT_NAME';

// Acted on directly rather than guarded by an existsSync: a check-then-use pair
// is a file-system race, and the failure it would catch is exactly what the
// rename already reports.
export function restoreGitignore(targetDir) {
  try {
    fs.renameSync(
      path.join(targetDir, GITIGNORE_TEMPLATE_NAME),
      path.join(targetDir, '.gitignore')
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      `Template is missing ${GITIGNORE_TEMPLATE_NAME}; scaffolding without it would commit node_modules.`
    );
  }
}

function stampProjectName(filePath, projectName) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Template is missing ${path.basename(filePath)}.`);
  }
  fs.writeFileSync(filePath, contents.replaceAll(PROJECT_NAME_PLACEHOLDER, projectName));
}

export function copyTemplate(targetDir, projectName) {
  const templatePath = getTemplatePath();

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template directory not found at ${templatePath}`);
  }

  copyRecursive(templatePath, targetDir);
  restoreGitignore(targetDir);

  stampProjectName(path.join(targetDir, 'README.md'), projectName);

  // Stamp the project name and scaffolder version into package.json
  const packageJsonPath = path.join(targetDir, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to parse package.json: ${error.message}`);
  }
  packageJson.name = projectName;
  packageJson.p1 = { ...packageJson.p1, templateVersion: getScaffolderVersion() };
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
}

export function copyRecursive(src, dest, rootDest) {
  // On first call, rootDest is the original destination directory
  if (!rootDest) {
    rootDest = path.resolve(dest);
  }

  // Validate that dest is within rootDest to prevent path traversal
  const resolvedDest = path.resolve(dest);
  if (!resolvedDest.startsWith(rootDest)) {
    throw new Error(`Path traversal detected: ${dest} is outside target directory`);
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Validate each destPath to prevent traversal attacks via entry.name
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
