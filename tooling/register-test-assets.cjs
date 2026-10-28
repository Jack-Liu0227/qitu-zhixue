const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { relative, resolve, sep } = require('node:path');

// Node component tests need the static-image metadata supplied by Next at build time.
const root = resolve(__dirname, '..');
require.extensions['.png'] = (assetModule, filename) => {
  const data = readFileSync(filename);
  assert.ok(data.length >= 24 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `Invalid PNG: ${filename}`);
  assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  assetModule.exports = {
    src: `/${relative(root, filename).split(sep).join('/')}`,
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
};
