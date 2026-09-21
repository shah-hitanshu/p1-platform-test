/**
 * `filename`, or the first `name-2`, `name-3`… variant that `taken` does not already hold.
 *
 * The assistant is told what a file is called and has nothing else to refer to it by, so two
 * files sharing a name leave it unable to act on either without asking which was meant.
 */
export function uniqueFilename(filename: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(filename)) return filename;

  // A leading dot names the file rather than its type, so `.gitignore` splits nowhere.
  const dot = filename.lastIndexOf('.');
  const [base, extension] = dot > 0
    ? [filename.slice(0, dot), filename.slice(dot)]
    : [filename, ''];

  let n = 2;
  while (used.has(`${base}-${String(n)}${extension}`)) n++;
  return `${base}-${String(n)}${extension}`;
}
