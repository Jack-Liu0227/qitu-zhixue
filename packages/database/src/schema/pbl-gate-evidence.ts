import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * PBL 门禁「待冲刷证据账本」（T21，服务端私有）。
 *
 * 存在的理由：门禁达成（确认意图 / TheoryMastered / 运行验证 / 评审归档）在
 * 真实产品时序里**早于**学生第一次进入 AI 搭档团队链路，`recordGateForStudent`
 * 当时没有活跃 run 可写事件。域服务（projects / mastery / works）在业务成功
 * 时向本表落一行账本（完全不感知 run）；`startRun` 建 run 后把未冲刷行
 * （consumed_at IS NULL）物化为 `team.gate.satisfied` 事件并回写
 * consumed_run_id / consumed_at（T22 实现冲刷）。
 *
 * 安全边界（AGENTS.md）：本表没有任何 HTTP 读写路径；门禁证据不可由客户端
 * 写入，唯一写入方是服务端域逻辑。
 *
 * 幂等核心：唯一索引 (student_user_id, gate, evidence_ref) —— 同一学生同一
 * 门禁同一证据只有一行，域侧 ON CONFLICT DO NOTHING 重放安全。
 * 索引名与列集合与迁移 0022 逐字一致（pbl-gate-evidence.test.ts 做文件级
 * 断言防漂移）。
 */
export const pblGateEvidence = pgTable(
  'pbl_gate_evidence',
  {
    id: text('id').primaryKey(),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    gate: text('gate').notNull(),
    evidenceRef: text('evidence_ref').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    consumedRunId: text('consumed_run_id'),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => ({
    studentGateRefUniqueIdx: uniqueIndex('pbl_gate_evidence_student_gate_ref_unique_idx').on(
      table.studentUserId,
      table.gate,
      table.evidenceRef,
    ),
    studentPendingIdx: index('pbl_gate_evidence_student_pending_idx').on(table.studentUserId, table.consumedAt),
  }),
);
