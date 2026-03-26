import { MAX_ACTOR_ID_LENGTH, MAX_PATH_DEPTH } from '../constants/security-limits';
import type { EditOperation } from '../types';

export const ACTOR_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate actor ID format
 * Returns error message if invalid, null if valid
 */
export function validateActorId(actorId: string): string | null {
  if (actorId.length > MAX_ACTOR_ID_LENGTH) {
    return `actorId exceeds maximum length of ${String(MAX_ACTOR_ID_LENGTH)}`;
  }

  if (!ACTOR_ID_PATTERN.test(actorId)) {
    return 'actorId contains invalid characters. Only alphanumeric, hyphens, and underscores allowed.';
  }

  return null;
}

/**
 * Validate an edit operation has required fields
 * Returns error message if invalid, null if valid
 */
export function validateOperation(op: EditOperation): string | null {
  // All operations require a path
  if (typeof op.path !== 'string' || op.path === '') {
    return `Operation ${op.type} requires a non-empty path`;
  }

  // Validate path format
  const pathError = validatePath(op.path);
  if (pathError !== null) {
    return pathError;
  }

  // Type-specific validation
  switch (op.type) {
    case 'set':
      if (op.value === undefined) {
        return 'set operation requires a value';
      }
      break;

    case 'insert':
      if (typeof op.index !== 'number') {
        return 'insert operation requires an index';
      }
      if (op.value === undefined) {
        return 'insert operation requires a value';
      }
      break;

    case 'move':
      if (typeof op.fromIndex !== 'number') {
        return 'move operation requires fromIndex';
      }
      if (typeof op.toIndex !== 'number') {
        return 'move operation requires toIndex';
      }
      break;

    case 'replace':
      if (op.content === undefined) {
        return 'replace operation requires content';
      }
      break;

    case 'delete':
      // delete only requires path, which we already checked
      break;
  }

  return null;
}

/**
 * Validate path format
 * Returns error message if invalid, null if valid
 */
export function validatePath(path: string): string | null {
  const parts = path.split('.');

  // Check for empty segments
  for (const part of parts) {
    if (part === '') {
      return 'Path contains empty segments';
    }
  }

  // Check depth limit
  if (parts.length > MAX_PATH_DEPTH) {
    return `Path exceeds maximum depth of ${String(MAX_PATH_DEPTH)}`;
  }

  return null;
}
