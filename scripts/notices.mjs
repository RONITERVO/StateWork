import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const entries = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path.includes('node_modules/') || pkg.link || !existsSync(join(path, 'package.json')))
    continue;
  const meta = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const licenses = readdirSync(path).filter((n) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(n));
  const texts = licenses.flatMap((n) => {
    try {
      return [`### ${n}\n\n\`\`\`text\n${readFileSync(join(path, n), 'utf8').trim()}\n\`\`\``];
    } catch {
      return [];
    }
  });
  entries.push(
    `## ${meta.name} ${meta.version}\n\nDeclared license: ${typeof meta.license === 'string' ? meta.license : JSON.stringify(meta.license ?? 'See package metadata')}. ${pkg.dev ? 'Development dependency.' : 'Runtime or transitive dependency.'}\n\n${texts.join('\n\n')}`,
  );
}
writeFileSync(
  'THIRD_PARTY_NOTICES.md',
  `# Third-party notices\n\nGenerated from the installed lockfile dependency set. Includes development and optional dependencies present on this machine; package managers supply platform-specific dependencies with their own notices. StateWork original code uses MIT.\n\n${entries.sort().join('\n\n')}\n`,
);
console.log(`Recorded ${entries.length} installed dependencies.`);
