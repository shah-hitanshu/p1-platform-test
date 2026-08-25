/**
 * Reads a JSON body from a handler under test.
 *
 * `Response.json()` returns `unknown`, which is correct but makes every
 * `expect(body.field)` a type error. Tests assert on shape rather than proving
 * it up front, so this returns an indexable record: enough to read a field
 * without claiming a type the test hasn't checked.
 *
 * Pass a type argument when a test genuinely needs the shape, e.g.
 * `await readJson<{ documents: Document[] }>(response)`.
 */
export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return await response.json();
}
