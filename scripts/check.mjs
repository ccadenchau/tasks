import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter(entry => !entry.name.startsWith('.') && !['node_modules', 'dist'].includes(entry.name)).map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const sources = (await files('.')).filter(file => /\.(m?js)$/.test(file));
const imports = new Map();
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
  if (file.startsWith('js/')) {
    const source = await readFile(file, 'utf8');
    const dependencies = [];
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const dependency = path.normalize(path.join(path.dirname(file), match[1]));
      await readFile(dependency); dependencies.push(dependency);
    }
    imports.set(file, dependencies);
  }
}
const used = new Set();
function visit(file) { if (used.has(file)) return; used.add(file); for (const dependency of imports.get(file) || []) visit(dependency); }
visit('js/main.js');
const unused = [...imports.keys()].filter(file => !used.has(file));
if (unused.length) throw new Error(`Unused application modules: ${unused.join(', ')}`);
const html = await readFile('index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) await readFile(match[1]);
console.log(`Checked ${sources.length} JavaScript files, static references, and application module reachability.`);
