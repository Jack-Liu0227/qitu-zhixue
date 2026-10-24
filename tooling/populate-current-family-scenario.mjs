import assert from 'node:assert/strict';

// User-authorized content for the existing demonstration family, via owner APIs only.
const origin = 'http://127.0.0.1:4100';
const prefix = 'family-scenario-20261024-v1';
const accounts = (await (await fetch(`${origin}/api/v1/auth/test-accounts`)).json()).data.accounts;
async function login(role, expectedId) {
  const account = accounts.find(item => item.role === role);
  assert.ok(account);
  const response = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request(cookie, '/auth/me')).id, expectedId, 'This script is limited to the authorized existing accounts');
  return cookie;
}
async function request(cookie, path, body, suffix, method) {
  const response = await fetch(`${origin}/api/v1${path}`, { method: method ?? (body ? 'POST' : 'GET'),
    headers: { cookie, 'content-type': 'application/json', ...(suffix ? { 'idempotency-key': `${prefix}-${suffix}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${value.code ?? value.error?.code ?? ''}`);
  return value.data;
}
const student = await login('student', 'student-demo');
const parent = await login('parent', 'parent-demo');
const teacher = await login('teacher', 'teacher-demo');
const children = await request(parent, '/parent/children');
assert.ok(children.some(child => child.childId === 'student-demo'));
const roster = await request(teacher, '/teacher/roster');
assert.ok(roster.students.some(child => child.studentId === 'student-demo'));
const before = await request(parent, '/parent/children/student-demo/dashboard');
let projectId = before.currentProject?.projectId ?? before.currentProject?.id;
if (!before.currentProject) {
  assert.ok(process.argv.includes('--create-project'), 'No active project. Creating another project requires an explicit --create-project invocation');
  const templates = await request(student, '/project-templates');
  const template = templates.find(item => item.slug === 'wave-interference-diffraction-8s-zero-base');
  assert.ok(template?.latestPublishedVersionId, 'The approved learning template must already be published');
  const created = await request(student, '/explorations', { source: 'recommended', templateVersionId: template.latestPublishedVersionId }, 'exploration');
  const explorationId = created.id ?? created.exploration?.id;
  assert.ok(explorationId);
  const authoritative = await request(student, `/explorations/${explorationId}`);
  assert.equal(authoritative.source, 'recommended', 'The scenario was changed; preserve the current account history');
  assert.equal(authoritative.templateVersionId, template.latestPublishedVersionId);
  await request(student, `/explorations/${explorationId}`, {
    goalUser: '比较单缝与双缝的明暗条纹，用观察记录说明它们的相同与不同',
    coreInterests: ['明暗条纹', '波的叠加', '比较观察'],
    preferredForm: '带有参数记录、图样标注和个人解释的探究档案',
    targetBeneficiary: '希望看懂明暗条纹的同学',
  }, null, 'PATCH');
  const confirmed = await request(student, `/explorations/${explorationId}/confirm-intent`, { templateVersionId: template.latestPublishedVersionId }, 'confirm-intent');
  projectId = confirmed.project.id;
}
assert.ok(projectId);

const encouragements = [
  '新一轮探究开始了，我很期待听你说说最想弄明白的问题。遇到暂时想不通的地方，可以先把观察记下来。',
  '谢谢你愿意分享自己的想法。你可以按自己的节奏解释，我会先认真听，再一起想下一步。',
];
for (const [index, message] of encouragements.entries()) {
  await request(parent, '/parent/children/student-demo/encouragements', { message }, `encouragement-${index}`);
}
const scenarios = [
  { content: '新项目开始后，希望老师给一些家庭陪伴建议：怎样追问孩子的观察，又不直接替孩子给出解释？',
    reply: '可以请孩子先说“看到了什么”，再问“哪一条记录支持这个想法”。如果一时解释不清，就把问题留下来，在下一次探究中比较。家庭陪伴以倾听和鼓励为主。' },
  { content: '希望了解每次探究后怎样整理观察记录，孩子能否用三句话回顾当天最重要的发现？',
    reply: '建议按“我改变了什么、我观察到什么、我还想验证什么”整理三句话，保留参数和图样。先保证观察能回看，再逐步补充解释。', resolved: true },
  { content: '这周希望安排一次简短交流，请老师帮忙看看孩子下一步的探究计划，便于我们在家配合时间。' },
];
const tickets = [];
for (const [index, scenario] of scenarios.entries()) {
  const submitted = await request(parent, '/parent/feedback', { source: 'project', childId: 'student-demo', projectId, messageId: null, content: scenario.content }, `feedback-${index}`);
  tickets.push(submitted.ticketId);
  if (scenario.reply) await request(teacher, `/teacher/feedback/${submitted.ticketId}/replies`, { content: scenario.reply }, `reply-${index}`);
  if (scenario.resolved) await request(parent, `/parent/feedback/${submitted.ticketId}/confirm`, { resolved: true, note: '这个整理方式清楚易用，我们会按这三个问题陪孩子回顾。' }, `confirm-feedback-${index}`);
}
const [home, feedback, studentActivity, teacherRoster, inbox] = await Promise.all([
  request(parent, '/parent/children/student-demo/dashboard'), request(parent, '/parent/children/student-demo/feedback'),
  request(student, '/students/me/learning-activity'), request(teacher, '/teacher/roster'), request(student, '/students/me/encouragements'),
]);
assert.equal(home.currentProject?.projectId ?? home.currentProject?.id, projectId);
const row = teacherRoster.students.find(item => item.studentId === 'student-demo');
assert.deepEqual(row.activity, studentActivity);
assert.ok(tickets.every(id => feedback.tickets.some(ticket => ticket.id === id)));
assert.ok(encouragements.every(message => inbox.some(item => item.message === message)));
console.log(JSON.stringify({ success: true, accounts: ['student-demo', 'parent-demo', 'teacher-demo'], projectId,
  scenarioTickets: tickets, encouragements: encouragements.length, existingArtifactsPreserved: before.recentArtifacts.length === home.recentArtifacts.length,
  activity: { sessions: studentActivity.sessionsThisWeek, minutes: studentActivity.minutesThisWeek } }));
