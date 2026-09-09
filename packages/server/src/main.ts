import { fileURLToPath } from 'node:url';
import { openLocal, seedDemo, codexPacketAssistant } from '@statework/node';
import { createServer } from './index.js';
const local = openLocal();
if (process.env.STATEWORK_DEMO !== '0') seedDemo(local.service.connect('local-owner'));
const port = Number(process.env.STATEWORK_PORT ?? 4180);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('STATEWORK_PORT must be an integer from 1024 to 65535.');
const app = await createServer({
  service: local.service,
  authenticate: (t) => local.store.authenticate(t),
  localToken: local.token,
  packetAssistant: process.env.STATEWORK_CODEX === '0' ? undefined : codexPacketAssistant(),
  port,
  staticRoot: fileURLToPath(new URL('../../reference/dist', import.meta.url)),
});
const stop = async () => {
  await app.close();
  local.service.close();
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
await app.listen({ host: '127.0.0.1', port });
process.stdout.write(
  `StateWork is ready at http://127.0.0.1:${port}\nYour data: ${local.home}\nLocal only. No accounts, cloud, or telemetry.\n`,
);
