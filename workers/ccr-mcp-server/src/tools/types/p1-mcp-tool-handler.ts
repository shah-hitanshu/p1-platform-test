import z from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { P1McpToolContext } from './p1-mcp-tool-context';

export type P1ToolHandler<S extends z.ZodTypeAny> = (ctx: P1McpToolContext
    , input: z.infer<S>) => Promise<CallToolResult>
