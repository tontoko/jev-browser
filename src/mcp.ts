import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { JevBrowser } from './browser.js';
import { commandSchemas, commandDescriptions, executeCommand, type CommandName, type Command } from './commands.js';
import { publicError } from './errors.js';

/** The caller owns the borrowed core, or its lazy factory's lifetime. */
export function createMcpServer(browser: JevBrowser | (() => Promise<JevBrowser>)): McpServer {
  const server = new McpServer({ name: 'jev-browser', version: '0.1.0' });
  for (const name of Object.keys(commandSchemas) as CommandName[]) {
    const inputSchema: z.ZodType = commandSchemas[name];
    const readOnly = ['snapshot', 'observe', 'extract', 'screenshot'].includes(name);
    server.registerTool(`browser_${name}`, {
      description: commandDescriptions[name], inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true },
    }, async (args, context) => {
      try {
        context.mcpReq.signal.throwIfAborted();
        const core = typeof browser === 'function' ? await browser() : browser;
        // SDK already validated args; Object.keys loses the key/shape correlation.
        const command = { ...(args as object), command: name } as Command;
        const result = await executeCommand(core, command, context.mcpReq.signal);
        if (name === 'screenshot') {
          const image = result as { data: string; mimeType: string };
          return { content: [{ type: 'image' as const, ...image }] };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError(error) }) }] };
      }
    });
  }
  return server;
}
