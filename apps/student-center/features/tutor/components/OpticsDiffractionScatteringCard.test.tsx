import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpticsDiffractionScatteringCard } from './OpticsDiffractionScatteringCard';

test('preview discloses model-only status and has no evidence submission button', () => {
  for (const initialMode of ['diffraction', 'scattering'] as const) {
    const html = renderToStaticMarkup(createElement(OpticsDiffractionScatteringCard, { initialMode, disabled: true }));
    assert.match(html, /全屏查看实验/);
    assert.match(html, /不是真实测量/);
    assert.match(html, /不保存观测/);
    assert.doesNotMatch(html, /实测中央|实测数据|已保存|<button[^>]*>[^<]*提交/);
    assert.doesNotMatch(html, /<input(?![^>]*disabled)/);
  }
});

test('outside the Rayleigh domain the preview does not calculate ratios or turn monochromatic light white', () => {
  const html = renderToStaticMarkup(createElement(OpticsDiffractionScatteringCard, {
    initialMode: 'scattering', initialParameters: { wavelength: 532, particleRadius: 150 },
  }));
  assert.match(html, /不计算强度比/);
  assert.match(html, /不会自动变白/);
  assert.doesNotMatch(html, /各色光无差别|各波长均匀|散射比: [\d.]+/);
});
