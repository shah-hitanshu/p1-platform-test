import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const blocksDir = import.meta.dirname;

/**
 * Render components that genuinely need client-side interactivity:
 *   tabs         — panel switching (useState)
 *   accordion    — open/close toggle (useState)
 *   gallery      — lightbox / slide state (useState)
 * Header and LeadCapture render a burger button and form shell respectively,
 * but the actual interactivity lives outside this package (CSS or consumer
 * scripts), so they stay as server components.
 */
const INTERACTIVE_RENDERS = ['accordion', 'gallery', 'tabs'];

const DIRECTIVE = /^\s*(['"])use client\1\s*;?/;

const blockDirs = readdirSync(blocksDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const hasDirective = (file: string) =>
  existsSync(file) && DIRECTIVE.test(readFileSync(file, 'utf8'));

describe('client boundary', () => {
  it('marks exactly the interactive render components', () => {
    const marked = blockDirs
      .filter((name) => hasDirective(join(blocksDir, name, `${name}.tsx`)))
      .sort();
    expect(marked).toEqual([...INTERACTIVE_RENDERS].sort());
  });

  it('marks every block config that imports the puck-css fields module', () => {
    // The fields module is itself "use client"; a config importing it without
    // the directive fails at the customer's build, not ours.
    const wrong = blockDirs.filter((name) => {
      const file = join(blocksDir, name, `${name}.block.tsx`);
      if (!existsSync(file)) return false;
      const source = readFileSync(file, 'utf8');
      return source.includes('@pantheon-systems/puck-css/fields') && !DIRECTIVE.test(source);
    });
    expect(wrong, `missing "use client": ${wrong.join(', ')}`).toEqual([]);
  });
});
