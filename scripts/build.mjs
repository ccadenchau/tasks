import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const name of ['index.html', 'css', 'js', 'sw.js', 'CNAME', '.nojekyll']) await cp(name, `dist/${name}`, { recursive: true });
console.log('Prepared browser assets in dist/.');
