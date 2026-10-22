export const LESSON_COLLABORATION_TASK = 'lesson.collaborate';
export const LESSON_COLLABORATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['suggestion', 'question'],
  properties: { suggestion: { type: 'string', minLength: 1, maxLength: 1000 }, question: { type: 'string', minLength: 1, maxLength: 300 } },
};
export interface LessonCollaborationScope {
  projectId: string; studentId: string; templateVersionId: string; teamVersionId: string;
  planId: string; planRevision: number; learningSessionId: string; activityId: string;
  recipientAssistantId: string; purpose: 'explain' | 'critique'; evidenceRefs: readonly string[];
}
