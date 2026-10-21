import { BadRequestException } from '@nestjs/common';

export interface VerifiedQuestionSource {
  sourceRef: string;
  knowledgeBaseId: string;
  documentRefHash: string;
  expiresAt: number;
  title?: string;
}
/** Passed by the server tool dispatcher, never from a model candidate or browser request. */
export type VerifyQuestionEvidence = (refs: readonly string[]) => Promise<readonly VerifiedQuestionSource[]>;
export async function verifyQuestionSources(refs: readonly string[], verify: VerifyQuestionEvidence) {
  const reject = (): never => { throw new BadRequestException({ code: 'QUESTION_SOURCE_UNVERIFIED', message: '动态题需要本轮已核验且仍获授权的知识材料。' }); };
  if (typeof verify !== 'function' || !refs.length || refs.length > 8 || new Set(refs).size !== refs.length) reject();
  const sources = await verify([...refs]);
  if (!Array.isArray(sources) || sources.length !== refs.length || sources.some(source => !source || typeof source !== 'object') || new Set(sources.map(source => source.sourceRef)).size !== refs.length) reject();
  const now = Date.now();
  return refs.map(ref => {
    const source = sources.find(item => item.sourceRef === ref);
    if (!source || typeof source.knowledgeBaseId !== 'string' || !source.knowledgeBaseId || source.knowledgeBaseId.length > 160 ||
      typeof source.documentRefHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.documentRefHash) ||
      !Number.isSafeInteger(source.expiresAt) || source.expiresAt <= now || source.expiresAt > now + 86400000) return reject();
    return { sourceRef: ref, knowledgeBaseId: source.knowledgeBaseId, documentRefHash: source.documentRefHash,
      expiresAt: source.expiresAt, ...(typeof source.title === 'string' ? { title: source.title.slice(0, 200) } : {}) };
  });
}
