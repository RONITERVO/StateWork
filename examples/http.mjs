import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkClient } from '@statework/sdk';
const token =
  process.env.STATEWORK_TOKEN ??
  readFileSync(resolve(process.env.STATEWORK_HOME ?? '.statework', 'local-token'), 'utf8').trim();
const client = new WorkClient('http://127.0.0.1:4180', token);
const workspaces = await client.list();
console.log(workspaces);
if (workspaces[0])
  console.log(await client.observe(workspaces[0].id, { query: { actionable: true }, limit: 5 }));
