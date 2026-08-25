/**
 * Where a page template's pages live.
 *
 * A template's route shape (`defaultUrlPattern`, e.g. `/blog/:slug`) is the only record of that,
 * and nothing downstream enforces it — a template page created off-pattern stays off-pattern,
 * invisible until someone builds navigation or a listing around the shape. The Create Page dialog
 * fills the shape's params itself before creating; this is the agent's equivalent.
 */

interface Segment {
  /** A `:param` segment, whose value comes from the requested path. */
  param: boolean;
  value: string;
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(segment => segment !== '');
}

function parsePattern(pattern: string): Segment[] {
  return pathSegments(pattern).map(segment =>
    segment.startsWith(':')
      ? { param: true, value: segment.slice(1) }
      : { param: false, value: segment },
  );
}

/** Whether the path already carries the shape's static segments in the shape's positions. */
function fitsShape(shape: Segment[], segments: string[]): boolean {
  return shape.length === segments.length
    && shape.every((segment, i) => segment.param || segment.value === segments[i]);
}

/**
 * How many leading segments of the path the shape's static prefix accounts for. Only the prefix
 * can be identified positionally: a param earlier in the shape absorbs an unknown number of them.
 */
function staticPrefixLength(shape: Segment[], segments: string[]): number {
  let consumed = 0;
  for (const segment of shape) {
    if (segment.param || segments[consumed] !== segment.value) break;
    consumed++;
  }
  return consumed;
}

function unfillableError(
  pattern: string,
  requestedPath: string,
  params: Segment[],
  templateLabel: string,
): Error {
  const names = params.map(param => param.value).join(', ');
  return new Error(
    `The "${templateLabel}" template's pages live at ${pattern}, and "${requestedPath}" does not ` +
    `fill every segment of it (${names}). Ask the user for the missing segments, then call ` +
    'create_page again with a path that fits the shape.',
  );
}

/**
 * The path a page built from this template belongs at, given the path the caller asked for.
 *
 * Untouched when the template has no route shape, or when the path already fits it. Otherwise the
 * path's trailing segments fill the shape's params — the slug is the last segment of a path, and a
 * path seeded by the Create Page dialog is the slug alone.
 *
 * @throws when the path supplies fewer segments than the shape has params, which is a question
 * for the user rather than something to invent.
 */
export function templatePagePath(
  pattern: string | undefined,
  requestedPath: string,
  templateLabel: string,
): string {
  if (pattern === undefined || pattern.trim() === '') return requestedPath;

  const shape = parsePattern(pattern);
  const params = shape.filter(segment => segment.param);
  // A pattern with no params names one fixed path, so it cannot be the shape of a set of pages.
  if (params.length === 0) return requestedPath;

  const given = pathSegments(requestedPath);
  if (fitsShape(shape, given)) return requestedPath;

  const available = given.slice(staticPrefixLength(shape, given));
  if (available.length < params.length) {
    throw unfillableError(pattern, requestedPath, params, templateLabel);
  }

  const values = available.slice(available.length - params.length);
  let next = 0;
  const resolved = shape
    .map(segment => (segment.param ? values[next++] : segment.value))
    .join('/');
  // The leading slash is the caller's convention; the backend normalizes either way.
  return requestedPath.startsWith('/') ? `/${resolved}` : resolved;
}
