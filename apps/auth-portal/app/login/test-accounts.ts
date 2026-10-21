import type { TestLoginAccount, TestLoginOptions } from '@qitu/contracts';

function isTestAccount(value: unknown): value is TestLoginAccount {
  if (typeof value !== 'object' || value === null) return false;
  return 'role' in value && typeof value.role === 'string' && ['student', 'parent', 'teacher', 'admin'].includes(value.role)
    && 'email' in value && typeof value.email === 'string' && value.email.length > 0
    && 'password' in value && typeof value.password === 'string' && value.password.length > 0;
}

export function parseTestLoginOptions(value: unknown): TestLoginOptions {
  if (typeof value !== 'object' || value === null || !('data' in value)) throw new Error('Invalid test login options');
  const data = value.data;
  if (typeof data !== 'object' || data === null || !('accounts' in data) || !Array.isArray(data.accounts)
    || data.accounts.length > 4 || !data.accounts.every(isTestAccount)
    || new Set(data.accounts.map(account => account.role)).size !== data.accounts.length) throw new Error('Invalid test login options');
  return { accounts: data.accounts };
}
