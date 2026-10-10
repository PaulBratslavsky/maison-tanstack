import type { Modules } from '@strapi/strapi';

/**
 * Same as `ai.mcp.defineTool` / `ai.mcp.definePrompt` from '@strapi/strapi' (identity functions that
 * infer handler types), without loading Strapi core at runtime.
 */
export const defineTool: Modules.MCP.McpToolBuilder = (tool: any) => tool;
export const definePrompt: Modules.MCP.McpPromptBuilder = (prompt: any) => prompt;
