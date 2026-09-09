import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexPacketAssistant } from '@statework/node';
import { WorkService, MemoryStore, packetContext } from '@statework/sdk';
const paths: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});
function context() {
  const c = new WorkService(new MemoryStore()).connect('fixture');
  c.create({ id: 'w', title: 'Fixture' });
  c.execute('w', {
    schemaVersion: 1,
    requestId: 'seed',
    expectedRevision: 0,
    commands: [{ type: 'item.create', item: { id: 'task', kind: 'task', title: 'Count bolts' } }],
  });
  return packetContext(c.snapshot('w'), 'task');
}
it('uses structured stdin, omits credentials and command tools, validates output and cleans temporary data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'statework-codex-fixture-'));
  paths.push(dir);
  const script = join(dir, 'codex.js'),
    capture = join(dir, 'capture.json');
  await writeFile(
    script,
    `const fs=require('node:fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const c=JSON.parse(input.split('BEGIN SOURCE BUNDLE\\n')[1].split('\\nEND SOURCE BUNDLE')[0]);fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),hasToken:!!process.env.STATEWORK_TOKEN,hasKey:!!process.env.CODEX_API_KEY}));const p={id:'draft',taskId:c.task.id,contextKey:c.key,title:c.task.title,outcome:'',requirements:[],steps:[],finish:'',questions:[],sourceIds:[],origin:'manual'};fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(p));});`,
  );
  vi.stubEnv('STATEWORK_CODEX_BIN', script);
  vi.stubEnv('STATEWORK_TOKEN', 'not-to-be-forwarded');
  vi.stubEnv('CODEX_API_KEY', 'not-to-be-forwarded');
  const p = await codexPacketAssistant().draft(context(), new AbortController().signal);
  expect(p.origin).toBe('codex');
  expect(p.id).not.toBe('draft');
  const data = JSON.parse(await readFile(capture, 'utf8'));
  expect(data.hasToken).toBe(false);
  expect(data.hasKey).toBe(false);
  expect(data.args).toEqual(
    expect.arrayContaining([
      '--ignore-user-config',
      '--ephemeral',
      'read-only',
      'shell_tool',
      'apps',
      'browser_use',
    ]),
  );
  await expect(readFile(join(data.cwd, 'packet.json'))).rejects.toThrow();
});
it('cancels a running local assistant process without saving any work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'statework-codex-cancel-'));
  paths.push(dir);
  const script = join(dir, 'codex.js'),
    started = join(dir, 'started');
  await writeFile(
    script,
    `require('node:fs').writeFileSync(${JSON.stringify(started)},String(process.pid));process.stdin.resume();setInterval(()=>{},1000);`,
  );
  vi.stubEnv('STATEWORK_CODEX_BIN', script);
  const controller = new AbortController();
  const promise = codexPacketAssistant().draft(context(), controller.signal);
  const assertion = expect(promise).rejects.toThrow('cancelled');
  let pid = 0;
  for (let i = 0; i < 100; i++) {
    try {
      pid = Number(await readFile(started, 'utf8'));
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  expect(pid).toBeGreaterThan(0);
  controller.abort();
  await assertion;
  expect(() => process.kill(pid, 0)).toThrow();
});
