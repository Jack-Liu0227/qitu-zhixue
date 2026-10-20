import { createHash } from 'node:crypto';
import type { CurrentUser, DirectoryPersonRef, TestLoginAccount, TestLoginOptions } from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';

const TEST_IDENTITIES = [
  { userId: 'student-demo', role: 'student', passwordVariable: 'QITU_TEST_LOGIN_PASSWORD_STUDENT' },
  { userId: 'parent-demo', role: 'parent', passwordVariable: 'QITU_TEST_LOGIN_PASSWORD_PARENT' },
  { userId: 'teacher-demo', role: 'teacher', passwordVariable: 'QITU_TEST_LOGIN_PASSWORD_TEACHER' },
  { userId: 'admin-demo', role: 'admin', passwordVariable: 'QITU_TEST_LOGIN_PASSWORD_ADMIN' },
] satisfies (Pick<DirectoryPersonRef, 'userId' | 'role'> & { passwordVariable: string })[];

function configuredPassword(identity: { passwordVariable: string }): string | undefined {
  const password = process.env[identity.passwordVariable];
  return process.env.QITU_TEST_LOGIN_ENABLED === 'true' && password && password.length <= 256 ? password : undefined;
}

export function allowsConfiguredTestLogin(user: Pick<DirectoryPersonRef, 'userId'> & Pick<CurrentUser, 'role'>): boolean {
  return TEST_IDENTITIES.some(identity => identity.userId === user.userId && identity.role === user.role && configuredPassword(identity) !== undefined);
}

export async function testLoginOptions(
  directory: Pick<DirectoryService, 'findUser' | 'findCredentialByEmail'>,
): Promise<TestLoginOptions> {
  const results = await Promise.all(TEST_IDENTITIES.map(async (identity): Promise<TestLoginAccount | null> => {
    const password = configuredPassword(identity);
    if (password === undefined) return null;
    const expectedHash = createHash('sha256').update(password, 'utf8').digest('hex');
    const user = await directory.findUser(identity.userId);
    if (!user || user.role !== identity.role) return null;
    const credential = await directory.findCredentialByEmail(user.email);
    if (!credential || credential.user.userId !== identity.userId || credential.user.role !== identity.role || credential.passwordHash !== expectedHash) return null;
    return { role: identity.role, email: user.email, password };
  }));
  return { accounts: results.flatMap(account => account ? [account] : []) };
}
