import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const originalDir = join(root, 'design-assets/visual-library/v1/originals');
const outputDir = join(root, 'packages/ui/assets/library');
const source = await readFile(join(root, 'packages/contracts/src/visual-assets.ts'), 'utf8');
const rows = [...source.matchAll(/asset\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)'\)/g)]
  .map(([, id, name, category, usage, motif]) => ({ id, name, category, usage, motif }));
await mkdir(outputDir, { recursive: true });
const available = new Set(await readdir(originalDir));
const manifest = [];
const imports = [], mappings = [];
for (const [index, asset] of rows.entries()) {
  const file = `${asset.id}.png`;
  if (!available.has(file)) throw new Error(`Missing generated artwork: ${file}`);
  const bytes = await readFile(join(originalDir, file));
  const metadata = await sharp(bytes).metadata();
  const transparent = asset.usage !== 'cover';
  if (transparent && !metadata.hasAlpha) throw new Error(`Missing alpha channel: ${file}`);
  const wide = asset.usage === 'cover' || asset.usage === 'illustration';
  const largeSize = wide ? 640 : 256;
  const variants = [];
  for (const size of [64, largeSize]) {
    const height = wide && size > 64 ? 360 : size;
    const outputName = `${asset.id}-${size}.png`;
    const buffer = await sharp(bytes).resize(size, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ palette: true, quality: 90, effort: 9 }).toBuffer();
    await writeFile(join(outputDir, outputName), buffer);
    variants.push({ file: outputName, width: size, height, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
  }
  imports.push(`import small${index} from '../assets/library/${asset.id}-64.png';`, `import large${index} from '../assets/library/${asset.id}-${largeSize}.png';`);
  mappings.push(`  '${asset.id}': { small: small${index}, large: large${index} },`);
  manifest.push({ ...asset, source: `originals/${file}`, tool: 'image_gen', model: 'not_exposed',
    sha256: createHash('sha256').update(bytes).digest('hex'), width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha, variants });
}
await writeFile(join(root, 'packages/ui/src/visual-asset-files.ts'), `${imports.join('\n')}\n\ntype ImageFile = { src: string; width: number; height: number };\nexport const VISUAL_FILES: Record<string, { small: ImageFile | string; large: ImageFile | string }> = {\n${mappings.join('\n')}\n};\n`);
await writeFile(join(root, 'design-assets/visual-library/v1/manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), assets: manifest }, null, 2) + '\n');

const tiles = await Promise.all(rows.map(async (asset) => ({ input: await sharp(join(outputDir, `${asset.id}-64.png`)).extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#edf2f8' }).png().toBuffer() })));
const columns = 10, tileSize = 88;
await sharp({ create: { width: columns * tileSize, height: Math.ceil(tiles.length / columns) * tileSize, channels: 4, background: '#edf2f8' } })
  .composite(tiles.map((tile, index) => ({ ...tile, left: (index % columns) * tileSize, top: Math.floor(index / columns) * tileSize })))
  .png().toFile(join(root, 'design-assets/visual-library/v1/contact-sheet.png'));
const cards = rows.map((asset) => `<article><img src="../../../packages/ui/assets/library/${asset.id}-${asset.usage === 'cover' || asset.usage === 'illustration' ? 640 : 256}.png" alt=""><strong>${asset.name}</strong><small>${asset.id}</small></article>`).join('\n');
await writeFile(join(root, 'design-assets/visual-library/v1/index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>启途素材库</title><style>body{font:16px system-ui;background:#f4f7fb;color:#132646;padding:24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}article{background:white;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px}img{width:100%;height:150px;object-fit:contain}small{color:#566780;overflow-wrap:anywhere}</style><h1>启途全站素材库 · 55 个可复用素材</h1><p>图片仅用于展示。头像和主题不授予角色、工具或教学权限。</p><main>${cards}</main></html>`);
process.stdout.write(`Prepared ${manifest.length} assets, ${manifest.reduce((sum, asset) => sum + asset.variants.length, 0)} variants.\n`);
