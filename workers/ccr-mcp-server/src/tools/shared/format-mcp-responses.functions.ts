import { CallToolResult } from '@modelcontextprotocol/sdk/types';

/** A tool result narrowed to the single text block these helpers produce. */
export interface TextToolResult extends CallToolResult {
  content: [{ type: 'text'; text: string }];
}

export function formatError(error: unknown): TextToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
export function formatResult(data: unknown): TextToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}
