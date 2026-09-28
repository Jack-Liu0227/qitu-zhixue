import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ObservationNote } from './ObservationNote';

/**
 * T3 / #5：「待观察」渲染回归（R-T3 的界面落点）。
 *
 * 证据不足时界面必须明确显示「待观察」，且不能把「没有数据」渲染成 0。
 * 有证据（observed）时该提示完全不渲染。
 */

test('pending_observation 渲染明确的「待观察」，而不是 0', () => {
  const html = renderToStaticMarkup(createElement(ObservationNote, { state: 'pending_observation' }));

  assert.match(html, /待观察/);
  assert.match(html, /role="note"/);
  assert.doesNotMatch(html, />\s*0\s*</);
});

test('observed 不渲染任何提示', () => {
  const html = renderToStaticMarkup(createElement(ObservationNote, { state: 'observed' }));
  assert.equal(html, '');
});
