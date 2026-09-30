export const MEMORY_KINDS = ['preference', 'interest', 'goal', 'teaching_strategy'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryScope = 'relationship' | 'agent';
export type MemoryStatus = 'candidate' | 'active' | 'deleted';
export const MEMORY_TOPICS = ['agent-memory.extract', 'agent-memory.index'] as const;
export const MEMORY_EXTRACTOR_VERSION = 'qitu.memory.v1';

export interface AgentMemoryRecord {
  id: string;
  studentId: string | null;
  partnerId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  sourceRef: string;
  sourceEventId: string;
  status: MemoryStatus;
  version: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  indexId?: string | null;
}

export interface MemoryNamespace {
  scope: MemoryScope;
  studentId: string | null;
  partnerId: string;
}
export interface MemoryIndexHit { recordId: string; version: number; score: number }
export interface MemoryIndexPort {
  reconcile(record: AgentMemoryRecord): Promise<string | null>;
  recall(namespace: MemoryNamespace, query: string, limit: number): Promise<MemoryIndexHit[]>;
  remove(record: AgentMemoryRecord): Promise<void>;
}
export interface MemoryEmbeddingPort {
  embed(texts: readonly string[]): Promise<number[][]>;
}
export interface MemoryCandidate { kind: Exclude<MemoryKind, 'teaching_strategy'>; quote: string }
export interface MemoryExtractorPort {
  extract(statement: string): Promise<MemoryCandidate[]>;
}
export interface MemoryView extends Omit<AgentMemoryRecord, 'studentId' | 'sourceEventId'> {}
export interface MemoryContextResult {
  status: 'ready' | 'disabled' | 'unavailable';
  records: readonly MemoryView[];
}

export function memoryNamespace(value: MemoryNamespace): string {
  if (!value.partnerId || value.partnerId.length > 100 ||
      (value.scope === 'relationship' && !value.studentId) ||
      (value.scope === 'agent' && value.studentId !== null)) {
    throw new Error('MEMORY_SCOPE_INVALID');
  }
  // Length-prefixed JSON prevents collisions without exposing a shared default user.
  return JSON.stringify([value.scope, value.studentId, value.partnerId]);
}

export function canRecallMemory(record: AgentMemoryRecord, namespace: MemoryNamespace, now: Date): boolean {
  return record.scope === namespace.scope && record.studentId === namespace.studentId &&
    record.partnerId === namespace.partnerId && record.status === 'active' &&
    (record.expiresAt === null || Date.parse(record.expiresAt) > now.getTime());
}

export function validateMemoryText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 240) {
    throw new Error('MEMORY_INPUT_INVALID');
  }
  const text = value.trim();
  if (/[\u0000-\u001f]/u.test(text) ||
      /(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b1[3-9]\d{9}\b|\b\d{15,18}[\dXx]?\b)/iu.test(text) ||
      /(?:密码|口令|手机号|身份证|家庭住址|诊断|自杀|password|api.?key|token|secret|ignore.{0,20}instructions|system.?prompt|忽略.{0,8}(规则|指令)|系统提示词|解锁实践|设置掌握度)/iu.test(text)) {
    throw new Error('MEMORY_CONTENT_REJECTED');
  }
  return text;
}

export function minimizeMemoryStatement(value: string): string | null {
  // Only retain an explicit durable statement, never an entire conversation.
  const parts = value.split(/[。！？!?\n]/u);
  const statement = parts.find((part) => /(?:我喜欢|我更喜欢|我想学|我的目标是|我习惯|请记住)/u.test(part));
  if (!statement || statement.length > 160) return null;
  try { return validateMemoryText(statement); } catch { return null; }
}

export function validateCandidates(raw: unknown, statement: string): MemoryCandidate[] {
  if (!Array.isArray(raw) || raw.length > 3) throw new Error('MEMORY_CANDIDATES_INVALID');
  return raw.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new Error('MEMORY_CANDIDATES_INVALID');
    const row = item as Record<string, unknown>;
    if (row.kind !== 'preference' && row.kind !== 'interest' && row.kind !== 'goal') {
      throw new Error('MEMORY_CANDIDATES_INVALID');
    }
    const quote = validateMemoryText(row.quote);
    if (!statement.includes(quote) || quote.length < 4 || minimizeMemoryStatement(quote) === null) {
      throw new Error('MEMORY_EVIDENCE_REQUIRED');
    }
    return { kind: row.kind, quote };
  });
}

export function selectMemoryHits(
  hits: readonly MemoryIndexHit[], records: readonly AgentMemoryRecord[], namespace: MemoryNamespace,
  now: Date, limit: number,
): MemoryView[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const result: MemoryView[] = [];
  for (const hit of hits) {
    const record = byId.get(hit.recordId);
    if (!record || seen.has(record.id) || hit.version !== record.version || !canRecallMemory(record, namespace, now)) continue;
    seen.add(record.id);
    const { studentId: _studentId, sourceEventId: _event, ...view } = record;
    result.push(view);
    if (result.length >= Math.max(1, Math.min(8, limit))) break;
  }
  return result;
}
