import z from 'zod';
import { P1McpTool } from '../types/p1-mcp-tool.js';

/**
 * Identity helper that infers a tool's schema type so its handler's `input` is
 * typed from `inputSchema`. Annotating a tool with `P1McpTool` instead collapses
 * the generic to its default and silently makes `input` `any`.
 */
export function defineTool<S extends z.ZodTypeAny>(tool: P1McpTool<S>): P1McpTool<S> {
  return tool;
}

/**
 * Identity helper for a domain's tool map. The constraint uses `P1McpTool<any>`
 * deliberately: a narrower bound (`ZodTypeAny`, `ZodType<any, any, any>`) fails
 * because `handler` puts the schema in a contravariant position.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTools<T extends Record<string, P1McpTool<any>>>(tools: T): T {
  return tools;
}
