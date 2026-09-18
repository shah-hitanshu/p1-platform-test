/** An absent property and a property containing undefined have different undo results. */
export type PropValue =
  | { exists: false }
  | { exists: true; value: unknown };

export function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];

  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function recoveryPointer(props: Record<string, unknown>, pointer: string): string {
  const segments = pointerSegments(pointer);
  let value: unknown = props;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] as string;
    if (Array.isArray(value) || value === null || typeof value !== 'object') {
      return encodePointer(segments.slice(0, index));
    }

    if (!Object.hasOwn(value, segment)) {
      return encodePointer(segments.slice(0, index + 1));
    }

    value = (value as Record<string, unknown>)[segment];
  }

  return pointer;
}

function encodePointer(segments: string[]): string {
  if (segments.length === 0) return '';

  const escaped = segments.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1'));
  return `/${escaped.join('/')}`;
}

export function readPropValue(props: unknown, pointer: string): PropValue {
  let value = props;

  for (const segment of pointerSegments(pointer)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      return { exists: false };
    }

    value = (value as Record<string, unknown>)[segment];
  }

  return { exists: true, value };
}

export function writePropValue(
  props: Record<string, unknown>,
  pointer: string,
  field: PropValue,
): Record<string, unknown> {
  function write(target: unknown, segments: string[]): unknown {
    const [head, ...rest] = segments;
    if (head === undefined) return field.exists ? field.value : undefined;

    if (Array.isArray(target)) {
      const next = target.slice();
      const index = Number(head);
      if (rest.length === 0 && !field.exists) {
        next.splice(index, 1);
      } else {
        next[index] = write(target[index], rest);
      }

      return next;
    }

    const next = { ...(target as Record<string, unknown> | undefined) };

    if (rest.length === 0 && !field.exists) {
      delete next[head];
    } else {
      next[head] = write(next[head], rest);
    }

    return next;
  }

  return write(props, pointerSegments(pointer)) as Record<string, unknown>;
}
