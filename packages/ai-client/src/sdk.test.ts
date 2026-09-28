import { validateLearningPlanDraft } from './curriculum.js';
import { createTutorSdk } from './sdk.js';
import { serializeTutorContext } from './context-packet.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runTutorSdkAssertions(): Promise<void> {
  const sdk = createTutorSdk({
    async loadLearnerProfile() {
      return {
        studentId: 'student-1', priorKnowledge: null,
        targetLevel: '入门', timeBudgetMinutesPerWeek: 120, preferences: ['动手'],
        interests: ['植物'], strengths: ['观察'], nextQuestions: [], version: 1,
        updatedAt: new Date().toISOString(),
      };
    },
    async listMemories() {
      return [{
        id: 'memory-1', studentId: 'student-1', partnerId: 'qitu-learning-partner', kind: 'interest' as const,
        content: '喜欢观察校园植物', confidence: 0.8, source: 'student' as const, visibility: 'student_private' as const,
        updatedAt: new Date().toISOString(),
      }];
    },
    async searchTemplates() {
      return [{
        document: {
          id: 'template-1', version: '1', title: '植物观察', summary: '从观察到小实验',
          tags: ['植物'], stage: 'exploration' as const, content: '...', scope: 'system' as const, active: true,
        }, score: 1, matchedTerms: ['植物'],
      }];
    },
    async searchKnowledge() {
      return [];
    },
    async ensurePartner() {},
    async upsertTemplate() {},
    async upsertKnowledge() {},
    async upsertLearnerProfile() {},
    async appendGrowthSignal() {},
    async upsertMemory() {},
  });
  const packet = await sdk.buildContext({
    studentId: 'student-1', projectId: null, projectStage: 'exploration',
    currentGoal: null, query: '植物', recentActivity: ['开始探索'],
  });
  assert(packet.partner.id === 'qitu-learning-partner', 'partner id missing');
  assert(packet.memories.length === 1, 'memory not included');
  assert(serializeTutorContext(packet).includes('植物观察'), 'template evidence missing');

  const draft = {
    templateVersion: 'v1', weeks: 4 as const, title: '计划', interest: '机器人',
    sessions: Array.from({ length: 20 }, (_, index) => ({
      id: `s-${index}`, week: Math.floor(index / 5) + 1, day: (index % 5) + 1,
      title: `第 ${index + 1} 次`, blocks: [{
        id: `b-${index}`, title: '实践', minutes: 60, objectiveIds: ['build'],
        activity: 'practice' as const, prerequisiteObjectiveIds: [],
      }],
    })),
  };
  const result = validateLearningPlanDraft(draft);
  assert(!result.ok, 'invalid practice plan accepted');
  assert(result.errors.some((error) => error.message.includes('prerequisite')), 'missing prerequisite error');
}
