import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ProjectStage, TutorProjectContext, TutorTurn } from '@qitu/contracts';
import type { LearningProjectRecord } from '../learning-plan/learning-plan.store';
import type { TutorService } from './tutor.service';

/** Provider/store unit tests isolate the governed context boundary. Binding and
 * frozen routing are exercised separately by tutor.runtime-identity/team-resolution. */
export function withTutorProviderContext(
  service: TutorService,
  readProject?: (id: string) => Promise<LearningProjectRecord | null>,
): TutorService {
  const author: NonNullable<TutorTurn['author']> = { id: 'fixture-mentor', name: 'Fixture mentor', role: 'coach' };
  const originalAuthor = (service as unknown as { resolveTurnAuthor: (...args: unknown[]) => Promise<NonNullable<TutorTurn['author']>> }).resolveTurnAuthor.bind(service);
  const team = { teamId: 'fixture-team', teamName: 'Fixture team', assistantId: author.id, assistantName: author.name };
  Object.assign(service, {
    resolveTurnAuthor: async (record: { projectId: string | null }, ...args: unknown[]) => record.projectId === null
      ? originalAuthor(record, ...args) : author,
    resolveTeamContext: async () => ({ team, phases: [], teamConfig: null }),
    getProjectContext: async (projectId: string, ownerId: string): Promise<TutorProjectContext> => {
      const row = readProject ? await readProject(projectId) : null;
      if (readProject && !row) throw new NotFoundException('Fixture project not found');
      if (row && row.studentId !== ownerId) throw new ForbiddenException('Fixture project belongs to another student');
      return {
        project: { id: projectId, title: row?.title ?? 'Fixture project', stage: (row?.status ?? 'theory_learning') as ProjectStage,
          progress: row?.progressPercent ?? 0, templateVersionId: row?.templateVersionId ?? undefined },
        progress: { currentStageIndex: row?.currentStageIndex ?? 2, stageTotal: 10, progressPercent: row?.progressPercent ?? 0 },
        stages: [], currentTask: null, phases: [],
        team,
      };
    },
  });
  return service;
}
