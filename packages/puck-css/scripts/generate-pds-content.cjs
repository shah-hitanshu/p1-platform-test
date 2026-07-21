#!/usr/bin/env node
// Generates src/pds/theme/pds-core-content.ts from pds-core.css.
// Run after updating @pantheon-systems/pds-toolkit-react.
// See CSSApp.tsx for why adoptedStyleSheets is used instead of a CSS import.
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '../src/pds/theme/pds-core.css');
const outPath = path.join(__dirname, '../src/pds/theme/pds-core-content.ts');

let css = fs.readFileSync(cssPath, 'utf8');
// Strip Google Fonts @import url() — fonts are in styles.css instead
css = css.replace(/@import url\("[^"]*"\);/g, '');

const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
fs.writeFileSync(outPath,
  '/* eslint-disable */\n' +
  '// Generated from @pantheon-systems/pds-toolkit-react/dist/css/pds-core.css\n' +
  '// Do not edit directly. Regenerate by running the build script after updating\n' +
  '// the pds-toolkit-react package version.\n' +
  '// See CSSApp.tsx for why this is a JS string rather than a CSS import.\n' +
  `export const pdsCoreCSS = \`${escaped}\`;\n`
);
console.log('Generated src/pds/theme/pds-core-content.ts');
