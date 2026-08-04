/** Repair markdown a streamed reply is part-way through, so it doesn't render as raw syntax. */
export function repairMarkdown(text: string): string {
  let out = text;

  const fences = out.match(/^ {0,3}```/gm);
  if (fences && fences.length % 2 === 1) out += '\n```';

  // A table parses only once its delimiter row lands; hold back a partial trailing row.
  out = out.replace(/\n[ \t]*\|[^\n]*$/, '');

  return out;
}
