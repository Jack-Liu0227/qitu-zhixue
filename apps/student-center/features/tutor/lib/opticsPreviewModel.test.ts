import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffractionPreview, scatteringPreview } from './opticsPreviewModel';

test('narrower slits and longer wavelengths widen the calculated central band', () => {
  const baseline = diffractionPreview(600, 50, 1);
  assert.ok(Math.abs(baseline.centralBandWidthMm - 24) < 0.01);
  assert.ok(diffractionPreview(600, 25, 1).centralBandWidthMm > baseline.centralBandWidthMm);
  assert.ok(diffractionPreview(700, 50, 1).centralBandWidthMm > baseline.centralBandWidthMm);
  assert.equal(diffractionPreview(600, 50, 2).centralBandWidthMm, 2 * baseline.centralBandWidthMm);
});

test('Rayleigh intensity ratios exist only within the approved small-particle domain', () => {
  const blue = scatteringPreview(450, 5);
  const red = scatteringPreview(700, 5);
  assert.equal(blue.isRayleigh, true);
  assert.ok(blue.rayleighRatio! > red.rayleighRatio!);
  assert.equal(scatteringPreview(450, 25).rayleighRatio, null);
  assert.equal(scatteringPreview(700, 300).rayleighRatio, null);
});

test('invalid or non-finite preview parameters are rejected', () => {
  for (const value of [NaN, Infinity, 0, 399, 751]) {
    assert.throws(() => diffractionPreview(value, 50, 1), RangeError);
    assert.throws(() => scatteringPreview(value, 5), RangeError);
  }
  assert.throws(() => diffractionPreview(600, 0, 1), RangeError);
  assert.throws(() => diffractionPreview(600, 50, -1), RangeError);
  assert.throws(() => scatteringPreview(600, 301), RangeError);
});
