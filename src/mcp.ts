import { version } from './version.js';
import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { JevBrowser } from './browser.js';
import { commandSchemas, commandDescriptions, commandReadOnly, executeCommand, type CommandName, type Command } from './commands.js';
import { publicError } from './errors.js';
import type { ScreenResult } from './screen.js';

/** The caller owns the borrowed core, or its lazy factory's lifetime. */
export function createMcpServer(browser: JevBrowser | (() => Promise<JevBrowser>), options: { screenOnly?: boolean } = {}): McpServer {
  const server = new McpServer({ name: 'jev-browser', version });
  const screenOnly = typeof browser === 'function' ? options.screenOnly === true : browser.screenOnly;
  const names: CommandName[] = screenOnly ? ['screen', 'close'] : Object.keys(commandSchemas) as CommandName[];
  for (const name of names) {
    const inputSchema: z.ZodType = commandSchemas[name];
    const readOnly = commandReadOnly(name);
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
        if (name === 'screen') {
          const screen = result as ScreenResult;
          const metadata = { ...screen, frames: screen.frames.map(({ data, path, ...frame }) => frame) };
          return { content: [
            { type: 'text' as const, text: JSON.stringify(metadata) },
            ...screen.frames.map(frame => ({ type: 'image' as const, data: frame.data, mimeType: frame.mimeType })),
          ], structuredContent: metadata };
        }
        if (name === 'screenshot' || name === 'take_screenshot') {
          const image = result as { data: string; mimeType: string; path?: string };
          return { content: [{ type: 'image' as const, data: image.data, mimeType: image.mimeType }, ...(image.path ? [{ type: 'text' as const, text: JSON.stringify({ path: image.path }) }] : [])] };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError(error) }) }] };
      }
    });
  }
  return server;
}
