import type { TutorContextPacket } from './tutor-context.js';



/** Build bounded, auditable prompt context without replaying raw chat history. */
export function serializeTutorContext(packet: TutorContextPacket): string {
  const lines = [
    `伙伴：${packet.partner.displayName}`,
    `伙伴职责定义：${boundedDefinition(packet.partner.roleDefinition)}`,
    `伙伴策略：${packet.partner.soul}`,
    `学习阶段：${packet.projectStage ?? 'exploration'}`,
    `当前目标：${packet.currentGoal ?? '尚未确认'}`,
  ];
  if (packet.learnerProfile !== null) {
    lines.push(`学习偏好：${packet.learnerProfile.preferences.join('、') || '未记录'}`);
    lines.push(`已知兴趣：${packet.learnerProfile.interests.join('、') || '未记录'}`);
    lines.push(`优势线索：${packet.learnerProfile.strengths.join('、') || '未记录'}`);
  }
  if (packet.memories.length > 0) {
    lines.push('关系记忆：');
    for (const memory of packet.memories.slice(0, 8)) {
      lines.push(`- [${memory.kind}] ${memory.content}`);
    }
  }
  if (packet.agentStrategies.length > 0) {
    lines.push('搭档教学策略（服务端已审核）：');
    for (const strategy of packet.agentStrategies.slice(0, 4)) {
      lines.push(`- ${bounded(strategy.content)}（来源：${strategy.source}）`);
    }
  }
  if (packet.templateEvidence.length > 0) {
    lines.push('相关模板证据：');
    for (const evidence of packet.templateEvidence.slice(0, 4)) {
      lines.push(`- ${evidence.document.title}（相关度 ${evidence.score.toFixed(2)}）：${evidence.document.summary}`);
      lines.push(`  证据：${bounded(evidence.document.content)}`);
    }
  }
  if (packet.knowledgeEvidence.length > 0) {
    lines.push('知识库证据：');
    for (const evidence of packet.knowledgeEvidence.slice(0, 4)) {
      lines.push(`- ${evidence.document.title}（相关度 ${evidence.score.toFixed(2)}）：${evidence.document.summary}`);
      lines.push(`  证据：${bounded(evidence.document.content)}`);
    }
  }
  if (packet.recentMessages && packet.recentMessages.length > 0) {
    lines.push('近期对话摘要：');
    for (const message of packet.recentMessages.slice(-6)) {
      lines.push(`- ${message.role === 'user' ? '学生' : '搭档'}：${bounded(message.content)}`);
    }
  }
  if (packet.recentActivity.length > 0) {
    lines.push(`近期活动：${packet.recentActivity.slice(-6).join('；')}`);
  }
  return lines.join('\n');
}

function boundedDefinition(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 1500 ? `${normalized.slice(0, 1500)}…` : normalized;
}
function bounded(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 360 ? `${normalized.slice(0, 360)}…` : normalized;
}
