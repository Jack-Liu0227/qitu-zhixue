import { ConflictException } from '@nestjs/common';
import type { TutorLearningSource } from '@qitu/contracts';
import type { ImaReadEvidence } from './ima-project-scope';

/** The model selects references; titles and the fact of reading come from the source owner. */
export async function resolveActivitySources(raw: unknown,
  verify: (refs: readonly string[]) => Promise<readonly ImaReadEvidence[]>,
): Promise<readonly TutorLearningSource[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8
    || raw.some(ref => typeof ref !== 'string' || !ref || ref.length > 200) || new Set(raw).size !== raw.length) {
    throw new ConflictException({ code: 'TUTOR_RESOURCE_INVALID', message: '请先检索并阅读当前课时已授权的资料。' });
  }
  const refs: string[] = raw;
  const sources = await verify(refs);
  if (sources.length !== refs.length || sources.some((source, index) => source.sourceRef !== refs[index]
    || !source.knowledgeBaseId || !/^[a-f0-9]{64}$/u.test(source.documentRefHash) || source.expiresAt <= Date.now())) {
    throw new ConflictException({ code: 'TUTOR_RESOURCE_UNVERIFIED', message: '资料引用未核验或已失效，请重新检索。' });
  }
  return sources.map(source => ({ sourceRef: source.sourceRef, title: source.title?.trim().slice(0, 200) || '已核验的教学资料' }));
}
