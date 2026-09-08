import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
for (const file of files('packages/core/src')) {
  const text = readFileSync(file, 'utf8');
  if (
    /(?:from\s+|import\s*\()\s*['"](?!\.\/|\.\.\/)/.test(text) ||
    /\b(?:Date\.now|Math\.random|fetch|setTimeout|setInterval|document|window|process)\b/.test(text)
  )
    throw new Error(`Core host boundary violated: ${file}`);
}
for (const file of files('packages/sdk/src'))
  if (/from\s*['"](?:node:|@statework\/(?:node|server|tools))/.test(readFileSync(file, 'utf8')))
    throw new Error(`SDK platform boundary violated: ${file}`);
for (const file of files('packages/reference/src'))
  if (/from\s*['"](?:node:|@statework\/(?:node|server|tools))/.test(readFileSync(file, 'utf8')))
    throw new Error(`Reference host boundary violated: ${file}`);
console.log('Core, SDK and reference package boundaries passed.');
