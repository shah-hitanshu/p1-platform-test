/**
 * A page's title lives at `root.props.title` in its snapshot, and nowhere else.
 *
 * Documents created without a template used to carry it at the snapshot's top
 * level while template-created documents got it from the skeleton at
 * `root.props.title`. Listings read only the top level, so template-created
 * pages appeared untitled. Writes now go to one place, and reads accept the
 * legacy location until existing snapshots are backfilled.
 */

interface SnapshotWithRoot {
  root?: { props: Record<string, unknown> };
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Seeds a new document's snapshot with its title at the canonical location. A
 * title already present in the snapshot wins: the snapshot is authored content,
 * while the argument only seeds a document that has none.
 */
export function applyTitleToSnapshot(
  snapshot: Record<string, unknown> | undefined,
  title: string | undefined,
): SnapshotWithRoot {
  const base: SnapshotWithRoot = isRecord(snapshot) ? { ...snapshot } : {};

  if (title === undefined) {
    return base;
  }

  const props = isRecord(base.root) && isRecord(base.root.props) ? { ...base.root.props } : {};
  if (props.title === undefined) {
    props.title = title;
  }

  return { ...base, root: { ...(isRecord(base.root) ? base.root : {}), props } };
}

/**
 * Reads a snapshot's title, accepting the legacy top-level location for
 * documents created before the write path was canonicalized.
 */
export function readSnapshotTitle(snapshot: unknown): string | undefined {
  if (!isRecord(snapshot)) {
    return undefined;
  }

  const root = snapshot.root;
  if (isRecord(root) && isRecord(root.props) && typeof root.props.title === 'string') {
    return root.props.title;
  }

  return typeof snapshot.title === 'string' ? snapshot.title : undefined;
}
