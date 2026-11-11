import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Performance budget, in gzipped kilobytes. The entry script is what every first visit pays for
 * before the landing page is interactive. React and React DOM are most of it, so the budget leaves
 * little room for anything else on that path. Pages off the signup path are split out and must stay small.
 */
const BUDGET_KB = { entryJs: 110, css: 8, lazyChunk: 30 };

const dir = 'dist/web';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const entry = /<script type="module" crossorigin src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
if (!entry) throw new Error('No entry script in dist/web/index.html. Run `npm run build` first.');

const kb = (file: string) => gzipSync(readFileSync(join(dir, 'assets', file))).length / 1024;
const rows = readdirSync(join(dir, 'assets'))
  .filter((file) => file.endsWith('.js') || file.endsWith('.css'))
  .map((file) => {
    const kind = file === entry ? 'entry' : file.endsWith('.css') ? 'css' : 'lazy';
    const budget = kind === 'entry' ? BUDGET_KB.entryJs : kind === 'css' ? BUDGET_KB.css : BUDGET_KB.lazyChunk;
    const size = kb(file);
    return { file, kind, 'gzip KB': Number(size.toFixed(1)), 'budget KB': budget, ok: size <= budget };
  });

console.table(rows);
const over = rows.filter((row) => !row.ok);
if (over.length > 0) {
  console.error(`Over budget: ${over.map((row) => row.file).join(', ')}`);
  process.exit(1);
}
console.log('All assets within budget.');
