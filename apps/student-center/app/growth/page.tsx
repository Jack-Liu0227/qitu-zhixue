import type { StudentGrowthFilterType } from '@qitu/contracts';
import { GrowthPage } from '../../features/growth';

/**
 * `/student/growth` — 成长轨迹 (student projection).
 *
 * A first-class nav destination since 2026-09-26 (peer of AI搭档), so this page
 * must stand on its own — it may not assume it was reached with a `projectId`.
 * The query params remain supported for project-scoped deep links from 今天 and
 * 我的项目; both entry styles land on the same full timeline.
 */
const VALID_INITIAL_TYPES: readonly StudentGrowthFilterType[] = [
  'all',
  'project_stage_completed',
  'artifact_published',
  'reflection_created',
  'objective_mastered',
];

export default async function GrowthRoute({
  searchParams,
}: {
  searchParams?: Promise<{ projectId?: string; type?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const projectId = params.projectId ?? null;
  const requestedType = params.type as StudentGrowthFilterType | undefined;
  const initialType = requestedType && VALID_INITIAL_TYPES.includes(requestedType) ? requestedType : 'all';
  return <GrowthPage projectId={projectId} initialType={initialType} />;
}
