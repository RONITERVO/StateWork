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
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'work_handoff',
        'work_source',
        'work_files',
        'work_file',
        'work_attach_file',
      ]),
    );
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
    const upload = {
      requestId: 'file',
      expectedRevision: 1,
      asset: {
        id: 'input',
        taskIds: ['task'],
        name: 'input.cad',
        mediaType: 'application/octet-stream',
        description: 'Original bytes',
        locator: 'Fixture',
        replaces: null,
      },
      base64: Buffer.from([0, 1, 255]).toString('base64'),
    };
    const attached = await client.callTool({
      name: 'work_attach_file',
      arguments: { workspaceId: 'mcp', upload },
    });
    expect(attached.isError).not.toBe(true);
    expect(
      await client.callTool({
        name: 'work_attach_file',
        arguments: { workspaceId: 'mcp', upload },
      }),
    ).toEqual(attached);
    expect(
      (
        await client.callTool({
          name: 'work_attach_file',
          arguments: {
            workspaceId: 'mcp',
            upload: { ...upload, requestId: 'invalid-bytes', expectedRevision: 2, base64: '!!!' },
          },
        })
      ).isError,
    ).toBe(true);
    const handoff = await client.callTool({
      name: 'work_handoff',
      arguments: { workspaceId: 'mcp', taskId: 'task' },
    });
    expect(JSON.stringify(handoff)).toContain('statework.handoff');
    expect(JSON.stringify(handoff)).toContain('externalActionsAuthorized');
    const part = await client.callTool({
      name: 'work_file',
      arguments: { workspaceId: 'mcp', assetId: 'input', offset: 1, limit: 2 },
    });
    expect(JSON.stringify(part)).toContain(Buffer.from([1, 255]).toString('base64'));
    const hidden = await client.callTool({
      name: 'work_file',
      arguments: { workspaceId: 'unknown', assetId: 'input' },
    });
    expect(hidden.isError).toBe(true);
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
