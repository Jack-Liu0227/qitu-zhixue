import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const folder = join(root, 'packages/ui/assets/logo');
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
mkdirSync(folder, { recursive: true });
copyFileSync(input.source, join(folder, 'source.png'));
copyFileSync(join(root, 'packages/ui/assets/brand/qitu-mark.png'), join(folder, 'mark.png'));
await sharp(input.crop).resize(600, 600, { fit: 'inside' }).png({ palette: true, effort: 10 }).toFile(join(folder, 'full.png'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(join(folder, 'receipt.json'), JSON.stringify({
  source: { filename: 'source.png', sha256: digest(join(folder, 'source.png')), note: 'Exact user-supplied original, retained unchanged' },
  fullLogo: { filename: 'full.png', sha256: digest(join(folder, 'full.png')), tool: 'built-in image_gen', model: 'not_exposed',
    prompt: input.prompt, cropSourceSha256: digest(input.crop), transformation: 'Crop white outer margins, then downsample for UI' },
  mark: { filename: 'mark.png', sha256: digest(join(folder, 'mark.png')), note: 'Existing transparent graphic mark of the same user-supplied identity; no wordmark' },
}, null, 2) + '\n');
