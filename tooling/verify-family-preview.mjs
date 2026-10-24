import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.env.QITU_FAMILY_PREVIEW_ORIGIN ?? 'http://127.0.0.1:4200';
if (!/^http:\/\/(127\.0\.0\.1:4200|122\.51\.130\.204:3210)$/.test(origin)) throw new Error('Only the independent scenario endpoint is allowed');
const accounts = (await (await fetch(`${origin}/api/v1/auth/test-accounts`)).json()).data.accounts;
async function login(role) {
  const account = accounts.find(item => item.role === role);
  assert.ok(account);
  const response = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie').split(';')[0];
}
async function request(cookie, path, body, key = randomUUID()) {
  const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET',
    headers: { cookie, 'content-type': 'application/json', 'idempotency-key': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  return { status: response.status, data: value.data, code: value.code ?? value.error?.code };
}
async function read(cookie, path) {
  const result = await request(cookie, path);
  assert.equal(result.status, 200, `${path}: ${result.status} ${result.code ?? ''}`);
  return result.data;
}
const [parent, teacher, student] = await Promise.all(['parent', 'teacher', 'student'].map(login));
const children = await read(parent, '/parent/children');
assert.ok(children.length >= 2);
const studentId = (await read(student, '/auth/me')).id;
const homes = await Promise.all(children.map(child => read(parent, `/parent/children/${child.childId}/dashboard`)));
assert.ok(homes.every((home, index) => home.childId === children[index].childId));
assert.ok(homes.every(home => !JSON.stringify(home).includes('暂未接入')));
assert.ok(!JSON.stringify(homes).includes('learning_interaction:'));
const activity = await read(student, '/students/me/learning-activity');
const roster = await read(teacher, '/teacher/roster');
const row = roster.students.find(item => item.studentId === studentId);
assert.ok(row?.signalsAvailable);
assert.equal(row.activity.sessionsThisWeek, activity.sessionsThisWeek);
assert.equal(row.activity.minutesThisWeek, activity.minutesThisWeek);
const home = homes.find(item => item.childId === studentId);
assert.equal(home.kpis.find(item => item.id === 'weekly_sessions').value, `${activity.sessionsThisWeek} 次`);
const profile = await read(student, '/students/me/profile');
assert.ok(profile.competencyOverview.dimensions.some(axis => axis.status === 'observed'));
assert.ok(profile.competencyOverview.dimensions.every(axis => axis.value === null));
assert.equal((await request(parent, '/parent/children/student-demo-2/dashboard')).status, 403);
assert.equal((await request(teacher, '/teacher/students/student-demo-2')).status, 403);
assert.equal((await request(parent, '/students/me/learning-activity')).status, 403);
const key = randomUUID();
const message = '看到你认真记录每一次观察，很愿意听你分享自己的发现。';
const encouragements = await Promise.all([1, 2].map(() => request(parent, `/parent/children/${studentId}/encouragements`, { message }, key)));
assert.ok(encouragements.every(result => result.status === 201));
assert.equal(encouragements[0].data.id, encouragements[1].data.id);
assert.equal((await request(parent, `/parent/children/${studentId}/encouragements`, { message: `${message}继续加油。` }, key)).status, 409);
const inbox = await read(student, '/students/me/encouragements');
assert.equal(inbox.filter(item => item.id === encouragements[0].data.id).length, 1);
let messages = await read(parent, `/parent/children/${studentId}/messages`);
assert.equal(messages.messagesAvailable, true);
const growthMessage = messages.messages.find(item => item.id.startsWith('growth:'));
assert.ok(growthMessage);
const ackKey = randomUUID();
const firstAck = await request(parent, `/parent/children/${studentId}/messages/${encodeURIComponent(growthMessage.id)}/ack`, { action: 'read' }, ackKey);
const replayAck = await request(parent, `/parent/children/${studentId}/messages/${encodeURIComponent(growthMessage.id)}/ack`, { action: 'read' }, ackKey);
assert.equal(firstAck.status, 200);
assert.deepEqual(firstAck.data, replayAck.data);
messages = await read(parent, `/parent/children/${studentId}/messages`);
assert.equal(messages.messages.find(item => item.id === growthMessage.id).status, 'read');
const progress = await read(parent, `/parent/children/${studentId}/progress`);
if (progress.focusWork) {
  const selected = await read(parent, `/parent/children/${studentId}/progress?artifactRef=${encodeURIComponent(progress.focusWork.artifactRef)}`);
  assert.equal(selected.focusWork.artifactRef, progress.focusWork.artifactRef);
  assert.ok(selected.focusVersions.length > 0);
  assert.ok(selected.focusVersions.every(version => !('objectKey' in version) && !('inlineText' in version)));
}
const feedback = await request(parent, '/parent/feedback', { source: 'message', childId: studentId, content: '希望老师帮孩子一起梳理观察与解释之间的联系。', messageId: growthMessage.id, projectId: null });
assert.equal(feedback.status, 201);
const interventions = await read(teacher, '/teacher/interventions');
if (interventions.items.length) {
  const item = interventions.items.find(item => item.status !== 'resolved') ?? interventions.items[0];
  const actionKey = randomUUID();
  const changed = await request(teacher, `/teacher/interventions/${item.id}/actions`, { action: 'resolve', note: '已经和孩子一起确定下一步的比较方法。' }, actionKey);
  assert.equal(changed.status, 201);
  assert.equal(changed.data.intervention.status, 'resolved');
  const replay = await request(teacher, `/teacher/interventions/${item.id}/actions`, { action: 'resolve', note: '已经和孩子一起确定下一步的比较方法。' }, actionKey);
  assert.deepEqual(replay.data, changed.data);
}
console.log(JSON.stringify({ success: true, children: children.length, studentActivity: { sessions: activity.sessionsThisWeek, minutes: activity.minutesThisWeek },
  checks: ['three-role statistics', 'profile observations without scores', 'cross-child permissions', 'durable encouragement replay', 'message receipt replay', 'authorized artifact versions', 'real feedback context', 'teacher response receipts'], origin }));
