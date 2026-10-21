import { BadRequestException } from '@nestjs/common';
import type { TutorTeamAgentToolCall, TutorTeamHistoryEntry } from '@qitu/contracts';

export interface TeamHistoryRow extends Record<string, unknown> { key: string; kind: string; occurred_at: Date | string; payload: unknown }
export interface TeamHistoryCursor { projectId: string; assistantId: string; at: string; key: string }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export function parseTeamHistoryCursor(value: string | undefined, projectId: string, assistantId: string): TeamHistoryCursor | null {
  if (!value) return null;
  try {
    if (value.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as TeamHistoryCursor;
    if (parsed.projectId !== projectId || parsed.assistantId !== assistantId || typeof parsed.key !== 'string'
      || parsed.key.length > 400 || !parsed.key || typeof parsed.at !== 'string'
      || !Number.isFinite(Date.parse(parsed.at)) || new Date(parsed.at).toISOString() !== parsed.at) throw Error();
    return parsed;
  } catch { throw new BadRequestException({ code: 'TUTOR_HISTORY_CURSOR_INVALID', message: '历史记录游标无效，请重新读取。' }); }
}

export function teamHistoryCursor(row: TeamHistoryRow, projectId: string, assistantId: string): string {
  return Buffer.from(JSON.stringify({ projectId, assistantId, at: new Date(row.occurred_at).toISOString(), key: row.key })).toString('base64url');
}

function tool(value: unknown, fallbackId: string, at: string): TutorTeamAgentToolCall | null {
  const call = object(value);
  if (!['running', 'done', 'error'].includes(String(call.status))) return null;
  const labels: Record<string, string> = {
    'tutor.propose_lesson_activity': '生成学习活动', 'ima_search': '检索项目教材',
    'ima_read_document': '阅读教材资料', 'search_knowledge': '检索项目教材',
    'read_document': '阅读教材资料', 'agent.runtime.run': '准备教学回复',
  };
  const name = typeof call.name === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(call.name) ? call.name : 'learning.tool';
  return { callId: typeof call.callId === 'string' ? call.callId.slice(0,250) : fallbackId,
    name, label: labels[name] ?? '学习工具', status: call.status as TutorTeamAgentToolCall['status'],
    summary: call.status === 'done' ? '工具调用已完成' : call.status === 'error' ? '工具调用失败' : '已记录工具调用，等待结果',
    startedAt: at, finishedAt: call.status === 'running' ? null : at };
}

export function projectTeamHistory(row: TeamHistoryRow, assistantId: string): TutorTeamHistoryEntry | null {
  const at = new Date(row.occurred_at).toISOString();
  const payload = object(row.payload);
  if (row.kind === 'conversation') {
    try {
      const metadata = JSON.parse(String(payload.content)) as { v?: number; author?: { id?: string } };
      if (metadata.v !== 1 || metadata.author?.id !== assistantId) return null;
    } catch { return null; }
    const blocks = Array.isArray(payload.blocks) ? payload.blocks.map(object) : [];
    // Only already-visible assistant text is projected. Never include student text,
    // internal metadata, hidden answers, tool arguments or raw tool results.
    const summary = blocks.filter(block => block.kind === 'text' && typeof block.text === 'string')
      .map(block => block.text as string).join('\n').slice(0, 600) || '导师提供了一次学习引导或互动活动。';
    return { id: row.key, kind: 'conversation', occurredAt: at, summary,
      toolCalls: blocks.filter(block => block.kind === 'tool').slice(0, 30)
        .flatMap((block, index) => { const result = tool(block.call, `${row.key}:${index}`, at); return result ? [result] : []; }) };
  }
  if (row.kind === 'tool') {
    const call = tool(payload, row.key, at);
    return { id: row.key, kind: 'tool', occurredAt: at, summary: call?.summary ?? '已记录一次工具调用。', toolCalls: call ? [call] : [] };
  }
  return { id: row.key, kind: 'collaboration', occurredAt: at,
    summary: typeof payload.type === 'string' && payload.type.endsWith('.result')
      ? '团队返回了一项协作结果。' : '团队记录了一项协作任务。', toolCalls: [] };
}
