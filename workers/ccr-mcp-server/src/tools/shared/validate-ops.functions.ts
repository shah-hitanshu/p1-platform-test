import {
  validateOps as _validateOps,
  type ValidationError,
} from '@pantheon-systems/p1-content-validator';
import { type TextToolResult } from './format-mcp-responses.functions.js';

// Narrow the loosely-typed package export to the input/output shape used here.
export const validateOps = _validateOps as (input: {
  operations: unknown[];
  registry: Record<string, unknown>;
  currentSnapshot?: Record<string, unknown>;
}) => { errors: ValidationError[] };

export function formatValidationError(errors: ValidationError[]): TextToolResult {
  const n = errors.length;
  const summary = `Validation failed: ${String(n)} error${n === 1 ? '' : 's'}. Correct the errors below and retry.`;
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(errors, null, 2)}` }],
    isError: true,
  };
}
