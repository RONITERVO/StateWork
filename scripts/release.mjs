import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const npmCli =
  process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const npm = (args, cwd = root) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const out = resolve('artifacts/release/0.1.0');
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, ['scripts/notices.mjs'], { stdio: 'inherit' });
const packages = ['core', 'sdk', 'node', 'server', 'tools'];
const tarballs = [];
for (const pkg of packages) {
  cpSync('LICENSE', `packages/${pkg}/LICENSE`);
  const packed = JSON.parse(
    npm(['pack', '--workspace', `@statework/${pkg}`, '--pack-destination', out, '--json']),
  );
  tarballs.push(join(out, packed[0].filename));
}
const staging = mkdtempSync(join(tmpdir(), 'statework-package-'));
writeFileSync(
  join(staging, 'package.json'),
  JSON.stringify({
    name: 'statework-package-check',
    version: '1.0.0',
    private: true,
    type: 'module',
  }),
);
npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], staging);
const smoke = `import { WorkService,MemoryStore } from '@statework/sdk';
import { SqliteStore } from '@statework/node';
import { createServer } from '@statework/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
const service=new WorkService(new MemoryStore());const work=service.connect('test');work.create({id:'smoke',title:'Packaged'});if(work.list().length!==1)throw new Error('SDK failed');
const sqlite=new SqliteStore(':memory:');sqlite.close();const app=await createServer({service,authenticate:()=>undefined});await app.close();service.close();
const client=new Client({name:'package-test',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('node_modules/@statework/tools/dist/mcp.js')],env:{...process.env,STATEWORK_HOME:resolve('mcp-data')},stderr:'pipe'}));if(!(await client.listTools()).tools.some(t=>t.name==='execute_work'))throw new Error('MCP failed');await client.close();console.log('Packaged SDK, SQLite, server and MCP passed.');`;
writeFileSync(join(staging, 'smoke.mjs'), smoke);
process.stdout.write(
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: staging, encoding: 'utf8' }),
);
execFileSync(process.execPath, ['node_modules/@statework/tools/dist/cli.js', 'help'], {
  cwd: staging,
  stdio: 'pipe',
});
// Root package packing uses an explicit source allowlist, never the user's data directory.
const sourceDir = mkdtempSync(join(tmpdir(), 'statework-source-'));
const allowed = [
  'packages',
  'scripts',
  'examples',
  'tests',
  'docs',
  'schemas',
  '.github',
  'README.md',
  'BUILD_BRIEF.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  '.gitignore',
  '.gitattributes',
  '.nvmrc',
  '.prettierrc.json',
  '.prettierignore',
];
for (const entry of allowed)
  cpSync(join(root, entry), join(sourceDir, entry), {
    recursive: true,
    filter: (source) =>
      !/(?:^|[\\/])(?:node_modules|dist|\.statework|\.git|artifacts|test-results|playwright-report)(?:[\\/]|$)|\.tsbuildinfo$|\.(?:sqlite|db)(?:-wal|-shm)?$|(?:^|[\\/])(?:local-token|\.env(?:\..*)?)$/.test(
        source,
      ),
  });
// npm pack would omit package-lock.json and rewrite metadata. Use the OS tar archive tool for exact source.
execFileSync('tar', ['-czf', join(out, 'statework-source-0.1.0.tar.gz'), '-C', sourceDir, '.'], {
  stdio: 'pipe',
});
const artifacts = readdirSync(out)
  .filter((n) => /\.(tgz|tar\.gz)$/.test(n))
  .sort();
writeFileSync(
  join(out, 'SHA256SUMS'),
  artifacts
    .map(
      (n) =>
        `${createHash('sha256')
          .update(readFileSync(join(out, n)))
          .digest('hex')}  ${n}`,
    )
    .join('\n') + '\n',
);
console.log(
  `Release artifacts: ${out}\nClean package installation verified. Temporary inspection directories: ${staging}, ${sourceDir}`,
);
