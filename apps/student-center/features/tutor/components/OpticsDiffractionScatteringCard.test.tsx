import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpticsDiffractionScatteringCard } from './OpticsDiffractionScatteringCard';

test('read-only preview explains prediction without an impossible unlock form or faded diagram', () => {
  for (const props of [{ disabled: true }, {}]) {
    const html = renderToStaticMarkup(createElement(OpticsDiffractionScatteringCard, {
      ...props, predictionGate: { required: true, submitted: false },
    }));
    assert.match(html, /当前可以查看示意，无需解锁/);
    assert.doesNotMatch(html, /type="radio"|确认预测并解锁|opacity:0\.45/);
    assert.match(html, /<fieldset disabled=""/);
  }
});

test('formal inquiry keeps prediction before controls without dimming the diagram', () => {
  for (const submitted of [false, true]) {
    const html = renderToStaticMarkup(createElement(OpticsDiffractionScatteringCard, {
      predictionGate: { required: true, submitted }, onAction: async () => false,
    }));
    assert.equal(html.includes('<fieldset disabled=""'), !submitted);
    assert.equal(html.includes('猜想不必正确'), !submitted);
    assert.doesNotMatch(html, /opacity:0\.45/);
  }
});

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

test('an accepted historical experiment can replay without an evidence submission form', () => {
  const savedObservation = {
    observationId: 'observation', evidenceRef: 'evidence', experimentId: 'experiment', runActionId: 'run',
    planId: 'plan', planRevision: 1, learningSessionId: 'lesson', objectiveId: 'objective',
    projectId: 'project', sessionId: 'tutor-session', parameterDigest: 'parameters', rubricRef: 'rubric', cerRef: 'cer',
    provenance: 'simulated_observation' as const, savedAt: '2026-10-24T00:00:00Z',
  };
  const html = renderToStaticMarkup(createElement(OpticsDiffractionScatteringCard, {
    readOnly: true, savedObservation, onAction: async () => { throw new Error('Review must not write'); },
  }));
  assert.match(html, /重新演示/);
  assert.match(html, /重置演示/);
  assert.match(html, /此前的模拟观察已保存/);
  assert.doesNotMatch(html, /<fieldset disabled=""|<textarea|记录观察/);
  const blocked = renderToStaticMarkup(createElement(OpticsDiffractionScatteringCard, { readOnly: true }));
  assert.doesNotMatch(blocked, /重新演示/);
  assert.match(blocked, /<fieldset disabled=""/);
});
