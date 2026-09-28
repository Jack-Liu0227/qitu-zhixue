import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EnvReminderDeliveryGate, StaticReminderDeliveryGate } from './reminder.gate';

/**
 * 投递门禁的 fail-closed 行为（ISSUE-T2 / R-T2）。
 *
 * 提醒面向未成年人，评审通过前必须默认关闭；即使显式开启，也要求
 * 持久化 / 审计能力可用，避免从内存投递却无法留痕。
 */

const ORIGINAL = process.env.QITU_REMINDER_DELIVERY_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.QITU_REMINDER_DELIVERY_ENABLED;
  } else {
    process.env.QITU_REMINDER_DELIVERY_ENABLED = ORIGINAL;
  }
});

test('默认关闭：未设置环境变量时不投递', () => {
  delete process.env.QITU_REMINDER_DELIVERY_ENABLED;
  assert.equal(new EnvReminderDeliveryGate(true).isDeliveryApproved(), false);
});

test('仅有开关但无持久化能力：仍不投递', () => {
  process.env.QITU_REMINDER_DELIVERY_ENABLED = 'true';
  assert.equal(new EnvReminderDeliveryGate(false).isDeliveryApproved(), false);
});

test('开关为其它值：不投递', () => {
  process.env.QITU_REMINDER_DELIVERY_ENABLED = '1';
  assert.equal(new EnvReminderDeliveryGate(true).isDeliveryApproved(), false);
});

test('开关开启且持久化可用：放行', () => {
  process.env.QITU_REMINDER_DELIVERY_ENABLED = 'true';
  assert.equal(new EnvReminderDeliveryGate(true).isDeliveryApproved(), true);
});

test('静态门禁按传入值决定（仅测试用）', () => {
  assert.equal(new StaticReminderDeliveryGate(false).isDeliveryApproved(), false);
  assert.equal(new StaticReminderDeliveryGate(true).isDeliveryApproved(), true);
});
