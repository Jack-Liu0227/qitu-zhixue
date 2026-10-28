import type { TutorContextPacket } from './tutor-context.js';
import type { TutorLessonProgram } from '@qitu/contracts';

export function serializeTutorLessonProgram(program: TutorLessonProgram): string {
  return JSON.stringify({
    ...program,
    ...(program.progression === 'dialogue.v1' ? { interactionGuidance: '教学活动是安排，不是五道提交门槛。围绕当前必要目标灵活讲解、举例、提问和反馈；学生直接在对话回答，服务端适配器自动留证并判断下一课。不要要求打开右侧、勾选证据、另贴答案或逐页签收。求助不记错；只认 owner 回执，不自行宣布掌握、完成或批准。正式作品仅在最后一课由学生确认交付；此前保留过程草稿。必要目标之外的提升建议不阻塞。仿真必须运行并保存观察，不把聊天描述当实验事实。若当前课已改变，简短衔接前课再引导新任务。' } : {}),
    learningGoal: program.learningGoal.slice(0, 2000),
    activities: program.activities.slice(0, 5).map(activity => ({ ...activity, guidance: activity.guidance.slice(0, 2400) })),
    evidenceRequirements: program.evidenceRequirements.slice(0, 16).map(value => value.slice(0, 600)),
  });
}



/** Build bounded, auditable prompt context without replaying raw chat history. */
export function serializeTutorContext(packet: TutorContextPacket): string {
  const runtime = packet.runtime;
  const lines = [
    runtime === undefined ? '' : `全局策略版本：${runtime.policyVersion}`,
    runtime === undefined ? '' : `Agent 定义：${boundedDefinition(runtime.agentDefinition)}`,
    ...(runtime?.skills ?? []).map((skill) => `Skill ${skill.id}（${skill.version ?? 'unknown'}）：${boundedDefinition(skill.content)}`),
    ...(runtime?.tools ?? []).map((tool) => `授权工具目录上限：${tool.id}（风险 ${tool.riskLevel}；本轮是否提供以实际调用清单为准）`),
    ...(runtime?.mcpServers ?? []).map((server) => `可用 MCP：${server.serverId}（${server.label}，工具 ${server.toolIds.join(', ') || '无'}）`),
    `伙伴：${packet.partner.displayName}`,
    `伙伴职责定义：${boundedDefinition(packet.partner.roleDefinition)}`,
    `伙伴策略：${packet.partner.soul}`,
    `学习阶段：${packet.projectStage ?? 'exploration'}`,
    `当前目标：${packet.currentGoal ?? '尚未确认'}`,
  ];
  if (packet.lessonProgram) {
    lines.push('当前冻结课时教案（按活动指导开展教学；保存、质量评价、掌握度和完成分别由服务端确认）：');
    lines.push(serializeTutorLessonProgram(packet.lessonProgram));
    if (packet.lessonProgram.currentActivity !== undefined) lines.push(packet.lessonProgram.currentActivity
      ? '本轮只围绕 currentActivity 的指导、学习证据和学生困难开展一个教学动作。课件页数不代表活动完成；不要讲授后续活动或越过待答题。'
      : '本课活动已无待办，等待服务端完成课时或后续审核，不自行生成下一课任务。');
  }
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
      lines.push(`- ${message.role === 'user' ? '学生' : '搭档'}：${bounded(message.content, 1200)}`);
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
function bounded(value: string, limit = 360): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}
