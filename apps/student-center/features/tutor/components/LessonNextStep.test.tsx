import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TutorProjectContext } from '@qitu/contracts';
import { LessonNextStep } from './LessonNextStep';

const lesson: NonNullable<TutorProjectContext['lesson']> = {
  lessonIndex: 1, lessonCount: 8, title: 'First lesson', status: 'current', assessmentAvailable: false,
  currentActivity: { activityId: 'lesson-1:activity:check', kind: 'check', evidence: 'session_response',
    status: 'current', guidance: 'Explain your observation.', minutes: 20, evidenceRefs: [] },
};
const render = (value = lesson, disabled = false) => renderToStaticMarkup(createElement(LessonNextStep, {
  lesson: value, disabled, onOpenRecords: () => {}, onExplain: () => {},
}));

test('a first lesson without formal assessment exposes the required response and evaluation path', () => {
  const html = render();
  assert.match(html, /保存本活动的回答与依据/);
  assert.match(html, /对话中的回答不会自动保存/);
  assert.match(html, /打开本课记录与评价/);
  assert.doesNotMatch(html, /进入下一课|已掌握|已完成/);
});

test('archived, locked and formally assessed activities do not offer a competing completion action', () => {
  assert.equal(render({ ...lesson, status: 'completed' }), '');
  assert.equal(render({ ...lesson, status: 'locked' }), '');
  for (const evidence of ['mastery', 'teaching_delivery'] as const) {
    assert.equal(render({ ...lesson, currentActivity: { ...lesson.currentActivity!, evidence } }), '');
  }
});

test('an activity-free current lesson requires owner confirmation and offline actions stay disabled', () => {
  assert.match(render({ ...lesson, currentActivity: null }), /下一课以服务端确认结果为准/);
  assert.match(render(lesson, true), /disabled=""/);
  const practice = { ...lesson, currentActivity: { ...lesson.currentActivity!, kind: 'practice' as const, evidence: 'experiment_observation' as const } };
  assert.match(render(practice), /继续本课实验/);
  assert.match(render(practice), /仅调整参数不会完成活动/);
});
