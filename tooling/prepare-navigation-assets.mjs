import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const folder = join(root, 'design-assets/fixed-navigation/v1');
const runtime = join(root, 'packages/ui/assets/navigation');
mkdirSync(folder, { recursive: true });
mkdirSync(runtime, { recursive: true });
const receiptPath = join(folder, 'receipt.json');
const rows = JSON.parse(readFileSync(process.argv[2] ?? receiptPath, 'utf8'));
const assets = Array.isArray(rows) ? rows : rows.assets;
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = [];
for (const row of assets) {
  if (!/^[a-z-]+$/.test(row.id)) throw new Error('Invalid navigation icon ID');
  const original = join(folder, `${row.id}-original.png`);
  if (row.source) copyFileSync(row.source, original);
  const metadata = await sharp(original).metadata();
  const stats = await sharp(original).stats();
  if (!metadata.hasAlpha || stats.channels.at(-1)?.min !== 0) throw new Error(`Missing transparency: ${row.id}`);
  const outputs = [];
  for (const size of [64, 128]) {
    const filename = `${row.id}-v1-${size}.png`;
    const path = join(runtime, filename);
    await sharp(original).resize(size, size, { fit: 'contain' }).png({ palette: true, effort: 10 }).toFile(path);
    outputs.push({ filename, size, bytes: readFileSync(path).length, sha256: hash(path) });
  }
  result.push({ id: row.id, sourceFilename: `${row.id}-original.png`, sourceSha256: hash(original), prompt: row.prompt, outputs });
}
writeFileSync(receiptPath, JSON.stringify({ tool: 'built-in image_gen', model: 'not_exposed', purpose: 'Unique fixed sidebar artwork; outside the selectable material catalog', assets: result }, null, 2) + '\n');
process.stdout.write(`Prepared ${result.length} transparent navigation originals and ${result.length * 2} runtime images.\n`);
