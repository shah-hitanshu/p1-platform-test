import { type StructuralConformanceError } from '@pantheon-systems/p1-content-validator';
import { type TextToolResult } from '../shared/format-mcp-responses.functions.js';

export function formatStructuralError(errors: StructuralConformanceError[]): TextToolResult {
  const n = errors.length;
  const summary = `Structural validation failed: ${String(n)} error${n === 1 ? '' : 's'}. The document does not conform to its template structure.`;
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(errors, null, 2)}` }],
    isError: true,
  };
}
