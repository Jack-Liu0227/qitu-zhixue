import type { TutorAgentToolDescriptor } from './index.js';

/** Canonical definitions. Presence declares an implementation kind, never a user's permission. */
export interface RuntimeToolCatalogEntry extends TutorAgentToolDescriptor {
  label: string;
  description: string;
  invocation: 'domain_service' | 'sdk_read' | 'model_tool';
  inputSchema?: Record<string, unknown>;
}

export const RUNTIME_TOOL_CATALOG: readonly RuntimeToolCatalogEntry[] = [
  {
    id: 'tutor.context_packet',
    label: 'Tutor context packet', description: 'Assemble bounded, permission-filtered context for one tutor turn.', invocation: 'domain_service',
    version: 'tutor.context_packet.v1',
    capabilities: ['explore', 'plan', 'teach', 'review', 'reflect', 'summarize'],
    execution: 'server_owned',
    riskLevel: 'medium',
    requiresTheoryMastered: false,
  },
  {
    id: 'tutor.pedagogy_move',
    label: 'Socratic pedagogy move', description: 'Select a hint-ladder move without releasing the expected answer.', invocation: 'domain_service',
    version: 'tutor.pedagogy_move.v1',
    capabilities: ['explore', 'plan', 'teach', 'review', 'reflect'],
    execution: 'server_owned',
    riskLevel: 'medium',
    requiresTheoryMastered: false,
  },
  {
    id: 'tutor.mastery_gate',
    label: 'Theory mastery gate', description: 'Check the server-owned TheoryMastered prerequisite before practice.', invocation: 'domain_service',
    version: 'tutor.mastery_gate.v1',
    capabilities: ['plan', 'teach', 'review'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: false,
  },
  {
    id: 'tutor.escalation',
    label: 'Teacher escalation', description: 'Create one idempotent teacher follow-up after a deterministic stall.', invocation: 'domain_service',
    version: 'tutor.escalation.v1',
    capabilities: ['teach', 'review', 'reflect'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: false,
  },
  {
    id: 'agent-memory.index',
    label: 'Agent memory index outbox', description: 'Process approved memory index events without exposing raw conversations.', invocation: 'domain_service',
    version: 'agent-memory.index.v1',
    capabilities: ['reflect', 'summarize'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: false,
  },
  {
    id: 'project.next_step',
    label: 'Project next-step selector', description: 'Select the next theory or practice objective from server-owned progress.', invocation: 'domain_service',
    version: 'project.next_step.v1',
    capabilities: ['plan', 'teach', 'review'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: true,
  },
  { id: 'mastery_query', version: 'mastery_query.v1', label: '知识掌握度查询', description: 'Requires server authorization on every execution', invocation: 'sdk_read',
    capabilities: ['explore', 'teach', 'review', 'reflect'], execution: 'server_owned', riskLevel: 'medium', requiresTheoryMastered: false, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { id: 'student_profile_get', version: 'student_profile_get.v1', label: '学生画像查询', description: 'Requires server authorization on every execution', invocation: 'sdk_read',
    capabilities: ['explore', 'teach', 'review', 'reflect'], execution: 'server_owned', riskLevel: 'medium', requiresTheoryMastered: false, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { id: 'knowledge_search', version: 'knowledge_search.v1', label: '知识库检索', description: '检索管理员授权的知识库，只返回真实资料证据', invocation: 'model_tool',
    capabilities: ['explore', 'teach', 'review', 'reflect'], execution: 'server_owned', riskLevel: 'medium', requiresTheoryMastered: false, inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 2000 }, topK: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false } },
  { id: 'knowledge_read', version: 'knowledge_read.v1', label: '知识库来源读取', description: '读取已授权知识库中检索命中的来源正文', invocation: 'model_tool',
    capabilities: ['explore', 'teach', 'review', 'reflect'], execution: 'server_owned', riskLevel: 'medium', requiresTheoryMastered: false, inputSchema: { type: 'object', properties: { citationId: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['citationId'], additionalProperties: false } },
];
