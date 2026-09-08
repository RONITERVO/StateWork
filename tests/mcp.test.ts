import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
it('serves real MCP discovery, observe and atomic mutations over stdio', async () => {
  const home = mkdtempSync(join(tmpdir(), 'statework-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/tools/dist/mcp.js')],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      STATEWORK_HOME: home,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'statework-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('execute_work');
    expect(
      (
        await client.callTool({
          name: 'create_workspace',
          arguments: { id: 'mcp', title: 'Agent work' },
        })
      ).isError,
    ).not.toBe(true);
    const request = {
      schemaVersion: 1,
      requestId: 'one',
      expectedRevision: 0,
      commands: [
        { type: 'item.create', item: { id: 'task', title: 'Accessible to agents', kind: 'task' } },
      ],
    };
    const first = await client.callTool({
      name: 'execute_work',
      arguments: { workspaceId: 'mcp', request },
    });
    const retry = await client.callTool({
      name: 'execute_work',
      arguments: { workspaceId: 'mcp', request },
    });
    expect(first).toEqual(retry);
    const observed = await client.callTool({
      name: 'observe_work',
      arguments: { workspaceId: 'mcp' },
    });
    expect(JSON.stringify(observed)).toContain('Accessible to agents');
    const invalid = await client.callTool({
      name: 'execute_work',
      arguments: { workspaceId: 'mcp', request: { ...request, requestId: 'stale' } },
    });
    expect(invalid.isError).toBe(true);
    expect((await client.listResources()).resources[0]?.uri).toBe('statework://workspaces');
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
});
