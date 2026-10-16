import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ServiceError } from './ima.js';

const schema = z.object({
  kb: z.string().min(1), id: z.string().min(1), title: z.string(),
  kind: z.enum(['document', 'folder']), expires: z.number().int(),
});
export type Reference = z.infer<typeof schema>;

// Signed references prevent a caller from supplying another knowledge base's media_id.
export class References {
  constructor(private readonly allowedIds: string[], private readonly secret = randomBytes(32)) {}

  issue(value: Omit<Reference, 'expires'>): string {
    this.allow(value.kb);
    const data = Buffer.from(JSON.stringify({ ...value, expires: Date.now() + 60 * 60 * 1000 })).toString('base64url');
    return `${data}.${createHmac('sha256', this.secret).update(data).digest('base64url')}`;
  }

  read(token: string, kind: Reference['kind']): Reference {
    const [data, sig, extra] = token.split('.');
    if (!data || !sig || extra || token.length > 16000) return this.invalid();
    const expected = createHmac('sha256', this.secret).update(data).digest();
    const supplied = Buffer.from(sig, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return this.invalid();
    let parsed: Reference;
    try { parsed = schema.parse(JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))); }
    catch { return this.invalid(); }
    if (parsed.kind !== kind || parsed.expires < Date.now()) return this.invalid();
    this.allow(parsed.kb);
    return parsed;
  }

  allow(kb: string): void {
    if (!this.allowedIds.includes(kb)) throw new ServiceError('FORBIDDEN_KNOWLEDGE_BASE', '该知识库未获本服务授权。');
  }
  private invalid(): never {
    throw new ServiceError('INVALID_REFERENCE', '资料引用无效或已过期，请重新搜索或浏览资料。');
  }
}
