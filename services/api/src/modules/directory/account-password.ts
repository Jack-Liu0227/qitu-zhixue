import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export function deriveAccountSecret(value: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(value, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashAccountPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await deriveAccountSecret(password, salt)).toString('hex')}`;
}

export async function matchesAccountPassword(password: string, encoded: string): Promise<boolean> {
  const parts = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!parts?.[1] || !parts[2]) return false;
  return timingSafeEqual(
    await deriveAccountSecret(password, parts[1]),
    Buffer.from(parts[2], 'hex'),
  );
}
