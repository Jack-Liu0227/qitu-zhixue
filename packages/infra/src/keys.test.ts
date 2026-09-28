import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisKeyError } from './errors';
import { RedisKeyBuilder } from './keys';

test('全局键：namespace:section:parts', () => {
  const keys = new RedisKeyBuilder('qitu');
  assert.equal(keys.global('health', 'probe'), 'qitu:health:probe');
});

test('学校作用域键：不同学校不撞键', () => {
  const keys = new RedisKeyBuilder('qitu');
  const schoolA = keys.school('school-a', 'cache', 'tutor-plan', 'p1');
  const schoolB = keys.school('school-b', 'cache', 'tutor-plan', 'p1');
  assert.equal(schoolA, 'qitu:school:school-a:cache:tutor-plan:p1');
  assert.notEqual(schoolA, schoolB);
});

test('学生作用域键：同一学校内不同学生不撞键', () => {
  const keys = new RedisKeyBuilder('qitu');
  const stu1 = keys.student('school-a', 'stu-1', 'cache', 'profile');
  const stu2 = keys.student('school-a', 'stu-2', 'cache', 'profile');
  assert.equal(stu1, 'qitu:school:school-a:student:stu-1:cache:profile');
  assert.notEqual(stu1, stu2);
});

test('学校 + 学生作用域同时区分学校与学生', () => {
  const keys = new RedisKeyBuilder('qitu');
  const a = keys.student('school-a', 'stu-1', 'lock', 'project', 'p1');
  const b = keys.student('school-b', 'stu-1', 'lock', 'project', 'p1');
  const c = keys.student('school-a', 'stu-2', 'lock', 'project', 'p1');
  assert.equal(new Set([a, b, c]).size, 3);
});

test('绑定作用域的便捷构造器：cache / lock / queue 前缀区分', () => {
  const keys = new RedisKeyBuilder('qitu').forScope({ schoolId: 'school-a', studentId: 'stu-1' });
  assert.equal(
    keys.cache('tutor', 'session-1'),
    'qitu:school:school-a:student:stu-1:cache:tutor:session-1',
  );
  assert.equal(keys.lock('project', 'p1'), 'qitu:school:school-a:student:stu-1:lock:project:p1');
  assert.equal(
    keys.queue('outbox', 'topic-x'),
    'qitu:school:school-a:student:stu-1:queue:outbox:topic-x',
  );
});

test('只带学校的作用域省略 student 段', () => {
  const keys = new RedisKeyBuilder('qitu').forScope({ schoolId: 'school-a' });
  assert.equal(keys.cache('stats'), 'qitu:school:school-a:cache:stats');
});

test('数字键段被接受，相同输入键稳定', () => {
  const keys = new RedisKeyBuilder('qitu');
  assert.equal(keys.global('page', 1), keys.global('page', '1'));
});

test('非法键段被拒绝：空、含冒号、通配符', () => {
  const keys = new RedisKeyBuilder('qitu');
  assert.throws(() => keys.global('cache', ''), RedisKeyError);
  assert.throws(() => keys.global('cache', 'a:b'), RedisKeyError);
  assert.throws(() => keys.school('', 'cache'), RedisKeyError);
  assert.throws(() => keys.student('school-a', 'stu:1', 'cache'), RedisKeyError);
  assert.throws(() => keys.global('cache', 'a*'), RedisKeyError);
});
