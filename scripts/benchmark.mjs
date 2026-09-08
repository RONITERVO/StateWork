import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WorkService } from '@statework/sdk';
import { SqliteStore } from '@statework/node';
const store = new SqliteStore(':memory:');
const work = new WorkService(store).connect('benchmark');
work.create({ id: 'bench', title: 'Benchmark' });
const count = 1000;
const seedStart = performance.now();
for (let start = 0; start < count; start += 100)
  work.execute('bench', {
    schemaVersion: 1,
    requestId: `seed-${start}`,
    expectedRevision: start / 100,
    commands: Array.from({ length: 100 }, (_, i) => ({
      type: 'item.create',
      item: {
        id: `item-${start + i}`,
        title: `Task ${start + i}`,
        kind: 'task',
        status: 'ready',
        priority: (start + i) % 4,
      },
    })),
  });
for (let start = 1; start < count; start += 100) {
  const commands = Array.from({ length: Math.min(100, count - start) }, (_, i) => ({
    type: 'relation.add',
    relation: {
      id: `edge-${start + i}`,
      kind: 'depends_on',
      from: `item-${start + i}`,
      to: `item-${start + i - 1}`,
    },
  }));
  work.execute('bench', {
    schemaVersion: 1,
    requestId: `edges-${start}`,
    expectedRevision: work.snapshot('bench').workspace.revision,
    commands,
  });
}
const seededMs = performance.now() - seedStart;
const timings = [];
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  const obs = work.observe('bench', { query: { actionable: true }, limit: 100 });
  if (obs.total !== 1) throw new Error('Incorrect benchmark observation');
  timings.push(performance.now() - t);
}
timings.sort((a, b) => a - b);
const result = {
  at: new Date().toISOString(),
  runtime: process.version,
  os: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  storage: 'in-memory SQLite; no disk durability latency measured',
  items: count,
  edges: count - 1,
  seededMs: Number(seededMs.toFixed(2)),
  observationMedianMs: Number(timings[10].toFixed(2)),
  observationP95Ms: Number(timings[19].toFixed(2)),
  samples: 20,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/benchmark.json', JSON.stringify(result, null, 2) + '\n');
console.log(result);
store.close();
