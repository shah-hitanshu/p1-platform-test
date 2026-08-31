import { ToolAnnotations } from '@modelcontextprotocol/sdk/types';
import z from 'zod';
import { P1ToolHandler } from './p1-mcp-tool-handler';

/**
 * One tool, whole. The tool's name is the key it is registered under in its
 * domain's map, so it is not repeated here.
 */
export interface P1McpTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  description: string;
  inputSchema: S;
  annotations?: ToolAnnotations;
  /** Selects the tighter rate limiter. Required so a new tool must decide. */
  mutates: boolean;
  handler: P1ToolHandler<S>;
}
