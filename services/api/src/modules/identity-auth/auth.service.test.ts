import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AuthService, studentDeviceLimit } from './auth.service';

const PASSWORD = 'student-password';
const PASSWORD_HASH = createHash('sha256').update(PASSWORD, 'utf8').digest('hex');
const STUDENT = {
  user: { userId: 'student-1', email: 'student@example.test', displayName: '学生', role: 'student' },
  passwordHash: PASSWORD_HASH,
};

function createService(): AuthService {
  const directory = { findCredentialByEmail: async () => STUDENT };
  return new AuthService(directory as never);
}

test('student devices: default limit is two', () => {
  assert.equal(studentDeviceLimit(undefined), 2);
  assert.equal(studentDeviceLimit('3'), 3);
  assert.equal(studentDeviceLimit('0'), 2);
});

test('user can use two devices concurrently; a third evicts the earliest device', async () => {
  const auth = createService();
  const first = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-a', { id: 'device-0001', userAgent: 'Chrome/120 Windows' });
  const second = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-b', { id: 'device-0002', userAgent: 'Safari/17 iPhone' });

  assert.equal(auth.getSession(first.token).user.id, 'student-1');
  assert.equal(auth.getSession(second.token).user.id, 'student-1');
  assert.equal(auth.listStudentDevices('student-1').length, 2);

  const third = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-c', { id: 'device-0003', userAgent: 'Firefox/120 Linux' });

  // First device was the earliest and is now squeezed out
  assert.throws(() => auth.getSession(first.token));

  // Second and third devices remain active
  assert.equal(auth.getSession(second.token).user.id, 'student-1');
  assert.equal(auth.getSession(third.token).user.id, 'student-1');
  assert.equal(auth.listStudentDevices('student-1').length, 2);
});

test('same device refreshes its session; revoking another device frees a slot', async () => {
  const auth = createService();
  const first = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-a', { id: 'device-0001' });
  const refreshed = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-a', { id: 'device-0001' });
  assert.throws(() => auth.getSession(first.token));
  assert.equal(auth.listStudentDevices('student-1').length, 1);
  assert.equal(auth.listStudentDevices('student-1', refreshed.token)[0]?.current, true);

  const second = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-b', { id: 'device-0002' });
  const secondDevice = auth.listStudentDevices('student-1', refreshed.token).find((device) => !device.current);
  assert.ok(secondDevice);
  assert.equal(auth.revokeStudentDevice('student-1', secondDevice.id), true);
  assert.throws(() => auth.getSession(second.token));

  const third = await auth.login(STUDENT.user.email, PASSWORD, false, 'ip-c', { id: 'device-0003' });
  assert.equal(auth.getSession(third.token).user.id, 'student-1');
});
