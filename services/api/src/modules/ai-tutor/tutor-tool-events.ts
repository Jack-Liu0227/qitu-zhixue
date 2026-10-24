import type { ModelRuntimeToolEvent } from '@qitu/model-runtime';
import type { TutorStreamEvent } from './tutor.provider';
import { LESSON_ACTIVITY_FUNCTION, LESSON_ACTIVITY_TOOL } from './tutor-lesson-activity';

const labels: Readonly<Record<string, string>> = {
  [LESSON_ACTIVITY_FUNCTION]: '生成当前课时活动', mastery_query: '查看知识掌握记录',
  student_profile_get: '查看学习画像', knowledge_search: '检索知识库', knowledge_read: '读取资料来源',
  ima_list_knowledge_bases: '查看授权知识库', ima_list_documents: '查看教材目录',
  ima_search_knowledge: '检索知识库', ima_read_document: '读取教材内容',
};
const failures: Readonly<Record<string, string>> = {
  TOOL_ARGUMENT_INVALID: '本次参数需要调整，尚未执行。AI搭档将尝试修正。',
  COURSEWARE_INVALID: '课件内容格式需要调整，本次未保存。',
  COURSEWARE_NOT_AUTHORIZED: '课件目标或资料引用与当前活动不匹配，本次未保存。',
  COURSEWARE_CANDIDATE_REJECTED: '课件未通过内容校验，本次未保存。',
  KNOWLEDGE_SCOPE_UNAVAILABLE: '当前助手或项目缺少可用的知识库授权。',
  KNOWLEDGE_TOOL_REVOKED: '当前知识库工具授权已变化，请刷新课时后继续。',
  KNOWLEDGE_RETRIEVAL_DISABLED: '当前助手的资料检索已停用，请联系老师检查配置。',
  KNOWLEDGE_PROJECT_SCOPE_UNAVAILABLE: '本项目当前没有可用的知识库范围。',
  KNOWLEDGE_SOURCE_UNAVAILABLE: '资料引用已失效或无法读取，需要重新检索。',
  KNOWLEDGE_UPSTREAM_DENIED: '资料服务拒绝了本次访问，请老师检查知识库连接与授权。',
  KNOWLEDGE_UPSTREAM_UNAVAILABLE: '资料服务暂时无法完成检索，本次未取得教材依据。',
  LEARNER_READ_UNAVAILABLE: '当前学习记录无法读取，请稍后重试。',
  TOOL_BUDGET_EXHAUSTED: '本轮查询次数已用完，将使用已有结果继续。',
  PENDING_ASSESSMENT: '当前问题尚未完成，请继续回答已有问题。',
  OPTICS_SIMULATION_PRACTICE_GATED: '当前处于概念学习阶段，暂不进入实践模拟。',
};

export function tutorToolEvent(event: ModelRuntimeToolEvent): TutorStreamEvent {
  if (event.type === 'call') return { type: 'tool_call', callId: event.callId,
    name: event.name === LESSON_ACTIVITY_FUNCTION ? LESSON_ACTIVITY_TOOL : event.name,
    label: labels[event.name] ?? '执行学习工具' };
  const result = event.isError ? failures[event.errorCode ?? ''] ?? '本次工具调用未完成，可以重试。'
    : event.outcome === 'empty' ? '本次未找到相关资料，将调整关键词或使用已有资料继续。'
    : event.outcome === 'unchanged' ? '本轮已有活动，继续使用已保存内容。'
    : event.outcome === 'accepted' ? '服务端已保存教学活动。'
    : event.outcome === 'retrieved' ? '已取得资料，结果已提供给AI搭档。'
    : event.name === LESSON_ACTIVITY_FUNCTION ? '教学工具执行完成。'
    : ['mastery_query', 'student_profile_get'].includes(event.name) ? '已读取当前学生的学习记录。'
    : '资料查询完成。';
  return { type: 'tool_result', callId: event.callId, status: event.isError ? 'error' : 'done', result };
}
