import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanyMessage } from './company.integrations';
const message = (text: string) => ({
  header: { app_id: 'app' },
  event: {
    sender: { sender_type: 'user', sender_id: { open_id: 'sender' } },
    message: {
      chat_type: 'group',
      chat_id: 'group',
      message_type: 'text',
      message_id: 'message',
      content: JSON.stringify({ text }),
    },
  },
});
test('company groups require an explicit bounded command and known department', () => {
  assert.equal(parseCompanyMessage(message('普通聊天'), 'app'), null);
  assert.equal(parseCompanyMessage(message('/company unknown 做任务'), 'app'), null);
  assert.equal(parseCompanyMessage(message('/company data 分析经营'), 'other-app'), null);
  assert.equal(parseCompanyMessage(message(`/company data ${'x'.repeat(4001)}`), 'app'), null);
  assert.equal(
    parseCompanyMessage(message('@_user_1 /company data 分析经营'), 'app')?.department,
    'data',
  );
  const bot = message('/company data 分析经营');
  bot.event.sender.sender_type = 'app';
  assert.equal(parseCompanyMessage(bot, 'app'), null);
});
