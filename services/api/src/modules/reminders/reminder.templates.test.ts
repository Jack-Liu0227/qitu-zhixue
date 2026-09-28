import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NON_MEDICAL_FORBIDDEN_TERMS,
  NonMedicalTemplateViolationError,
  REMINDER_TEMPLATES,
  assertNonMedicalTemplate,
} from './reminder.templates';

/**
 * 提醒模板白名单 / 非医疗断言（ISSUE-T2 / R-T2）。
 *
 * 这是管线里最重要的一道闸门：任何医疗、情绪、诊断、风险、标签化措辞都
 * 不得进入对学生可见的文案。
 */

test('白名单模板全部不含医疗 / 情绪 / 风险 / 标签化措辞', () => {
  for (const template of Object.values(REMINDER_TEMPLATES)) {
    const haystack = `${template.title}\n${template.body}`;
    for (const term of NON_MEDICAL_FORBIDDEN_TERMS) {
      assert.equal(haystack.includes(term), false, `${template.id} 命中禁用词 ${term}`);
    }
  }
});

test('模板只使用唯一允许的触发源', () => {
  for (const template of Object.values(REMINDER_TEMPLATES)) {
    assert.equal(template.source, 'learning_progress_stall');
  }
});

test('违规模板在启动期即抛错（fail-fast）', () => {
  assert.throws(
    () =>
      assertNonMedicalTemplate({
        id: 'learning_stall_take_break',
        category: 'rest_suggestion',
        source: 'learning_progress_stall',
        title: '你可能有点焦虑',
        body: '先做个情绪自评。',
      }),
    NonMedicalTemplateViolationError,
  );
});
