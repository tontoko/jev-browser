import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { createMcpServer } from '../dist/mcp.js';

test('MCP advertises flat screen arguments and rejects incomplete actions before browser startup', async t => {
  let starts = 0;
  const server = createMcpServer(async () => { starts++; throw new Error('Unexpected browser startup'); }, { screenOnly: true });
  const client = new Client({ name: 'screen-tool-schema', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st);
  await client.connect(ct);
  const schema = (await client.listTools()).tools.find(tool => tool.name === 'browser_screen').inputSchema;
  assert.equal(schema.type, 'object');
  assert(schema.properties?.action, 'tool consumers must see action among root object properties');
  assert.equal(schema.oneOf, undefined);
  assert.equal(schema.anyOf, undefined);
  assert.deepEqual(schema.required, ['action']);
  assert.deepEqual(schema.properties.action.enum, ['look', 'click', 'move', 'drag', 'scroll', 'type', 'press', 'back', 'forward', 'reload', 'wait']);
  assert.equal(schema.additionalProperties, false);
  const advertised = z.fromJSONSchema(schema);
  assert(advertised.safeParse({ action: 'look' }).success);
  assert(advertised.safeParse({ action: 'click', x: 20, y: 30, observationId: 'current' }).success);
  assert(advertised.safeParse({ action: 'look', capture: { frames: 3, intervalMs: 50 } }).success);
  for (const input of [
    {},
    { action: 'evaluate' },
    { action: 'look', selector: 'body' },
    { action: 'look', capture: { frames: 11, intervalMs: 50 } },
    { action: 'look', capture: { frames: 1, intervalMs: 1 } },
    { action: 'press', key: 'F12', observationId: 'current' },
  ]) assert.equal(advertised.safeParse(input).success, false);
  // Discovery accepts a flat object; execution must still validate the action union.
  for (const input of [
    { action: 'click', x: 20, y: 30 },
    { action: 'look', text: 'an unrelated action field' },
    { action: 'type', observationId: 'current' },
  ]) {
    const result = await client.callTool({ name: 'browser_screen', arguments: input });
    assert.equal(result.isError, true);
    assert.match(result.content.find(item => item.type === 'text').text, /INVALID_ARGUMENT/);
  }
  assert.equal(starts, 0);
});
