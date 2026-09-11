/**
 * The registration lines out of an item's `docs`, ready to paste into the
 * barrel — the leading "Register it in …" sentence and the trailing "Then edit
 * …" paragraph both dropped.
 *
 * Split out of the card so it can be held against what the registry actually
 * serves: the text is generated, so a change to its wording would otherwise
 * silently turn the catalog's copy button into a copy of nothing.
 *
 * Its own module, with no node: imports, because the card is a client
 * component — importing this from lib/registry.ts would pull that file's
 * node:fs into the browser bundle and fail the build.
 */
export function registrationSnippet(docs?: string): string {
  const paragraphs = docs?.split('\n\nThen edit')[0].split('\n\n') ?? [];
  return paragraphs.slice(1).join('\n\n');
}
