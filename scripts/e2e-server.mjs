import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openLocal, seedDemo } from '@statework/node';
import { createServer } from '@statework/server';
const home = mkdtempSync(join(tmpdir(), 'statework-browser-'));
const local = openLocal(home);
seedDemo(local.service.connect('local-owner'));
const app = await createServer({
  service: local.service,
  authenticate: (t) => local.store.authenticate(t),
  localToken: local.token,
  port: 4181,
  staticRoot: resolve('packages/reference/dist'),
});
await app.listen({ host: '127.0.0.1', port: 4181 });
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await app.close();
  local.service.close();
  rmSync(home, { recursive: true, force: true });
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
