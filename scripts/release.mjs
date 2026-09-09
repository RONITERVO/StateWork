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
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const out = resolve('artifacts/release', version);
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
import { SqliteStore, extractSource, exportFilePackage, importFilePackage } from '@statework/node';
import { createServer } from '@statework/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
const service=new WorkService(new MemoryStore());const work=service.connect('test');work.create({id:'smoke',title:'Packaged'});if(work.list().length!==1)throw new Error('SDK failed');
work.execute('smoke',{schemaVersion:1,requestId:'seed',expectedRevision:0,commands:[{type:'item.create',item:{id:'task',kind:'task',title:'File handoff'}}]});
await work.attach('smoke',{requestId:'file',expectedRevision:1,asset:{id:'original',taskIds:['task'],name:'original.bin',mediaType:'application/octet-stream',description:'Exact original bytes',locator:'Clean package fixture',replaces:null}},new Uint8Array([0,255,12]));
const bundle=work.exportBundle('smoke');await work.importBundle(bundle,{id:'copy',title:'Portable files'});if(work.asset('copy','original').bytes[1]!==255||!work.handoff('copy','task').assets[0].available)throw new Error('Packaged file handoff failed');
exportFilePackage(work,'smoke',resolve('portable-originals'));importFilePackage(work,resolve('portable-originals'),{id:'package-copy',title:'Original package'});if(work.asset('package-copy','original').bytes[1]!==255)throw new Error('Packaged directory transfer failed');
const sqlite=new SqliteStore(':memory:');sqlite.close();const app=await createServer({service,authenticate:()=>undefined});await app.close();service.close();
const extracted=await extractSource('instructions.txt',new TextEncoder().encode('Count two bolts.'));if(extracted.content!=='Count two bolts.')throw new Error('Packaged source worker failed');
const client=new Client({name:'package-test',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('node_modules/@statework/tools/dist/mcp.js')],env:{...process.env,STATEWORK_HOME:resolve('mcp-data')},stderr:'pipe'}));const names=(await client.listTools()).tools.map(t=>t.name);if(!['execute_work','work_handoff','work_source','work_files','work_file'].every(n=>names.includes(n)))throw new Error('MCP failed');await client.close();console.log('Packaged SDK, original-file handoff/bundle, SQLite, server, source worker and MCP passed.');`;
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
  '.agents',
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
execFileSync(
  'tar',
  ['-czf', join(out, `statework-source-${version}.tar.gz`), '-C', sourceDir, '.'],
  {
    stdio: 'pipe',
  },
);
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
