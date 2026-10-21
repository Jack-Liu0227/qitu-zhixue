import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const source = join(root, 'design-assets/fixed-interface/v1/sidebar-brand-original.png');
mkdirSync(join(root, 'design-assets/fixed-interface/v1'), { recursive: true });
if (process.argv[2]) copyFileSync(process.argv[2], source);
const output = join(root, 'packages/ui/assets/brand/qitu-sidebar-companion-v2.png');
await sharp(source).resize(256, 256, { fit: 'contain' }).png({ palette: true, effort: 10 }).toFile(output);
if (process.argv[3]) copyFileSync(process.argv[3], join(root, 'design-assets/fixed-interface/v1/user-avatar-original.png'));
const avatar = join(root, 'design-assets/fixed-interface/v1/user-avatar-original.png');
await sharp(avatar).resize(128, 128).png({ palette: true, effort: 10 }).toFile(join(root, 'packages/ui/assets/brand/qitu-user-avatar-v2.png'));
const assets = [
  { source: 'sidebar-brand-original.png', output: 'packages/ui/assets/brand/qitu-sidebar-companion-v2.png',
    description: 'Friendly white/cobalt/cyan robot face, transparent background, readable as a compact sidebar brand mark.' },
  { source: 'user-avatar-original.png', output: 'packages/ui/assets/brand/qitu-user-avatar-v2.png',
    description: 'Friendly stylized learner portrait, blue shirt, pale blue background; neutral default user avatar.' },
].map((asset) => ({ ...asset,
  sourceSha256: createHash('sha256').update(readFileSync(join(root, 'design-assets/fixed-interface/v1', asset.source))).digest('hex'),
  bytes: readFileSync(join(root, asset.output)).length,
  outputSha256: createHash('sha256').update(readFileSync(join(root, asset.output))).digest('hex'),
}));
writeFileSync(join(root, 'design-assets/fixed-interface/v1/receipt.json'), JSON.stringify({
  tool: 'image_gen', model: 'not_exposed', purpose: 'Fixed interface artwork; not selectable library entries', assets,
}, null, 2) + '\n');
