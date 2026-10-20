/** Historical declarations without a registered model-call executor. Never tool aliases. */
export interface LegacyToolBindingResolution {
  id: string;
  label: string;
  status: 'workflow_owned' | 'not_implemented';
  owner: string;
  explanation: string;
}

export const LEGACY_TOOL_BINDING_RESOLUTIONS: readonly LegacyToolBindingResolution[] = [
  { id: 'learning_plan_advance', label: '学习计划推进', status: 'workflow_owned', owner: 'learning-plan / projects', explanation: '按课时完成证据和项目门禁由服务端推进，不向模型授予阶段写入工具。' },
  { id: 'mastery_assess', label: '掌握度评估', status: 'workflow_owned', owner: 'mastery / lesson-assessment', explanation: '题目实例、答案与掌握度由原评估服务处理，不能把评估写入等同于门禁查询。' },
  { id: 'simulation_runner', label: '实验仿真', status: 'workflow_owned', owner: 'tutor experiment actions', explanation: '使用已注册光学模型及服务端实验 action，保留权限、参数范围和理论门禁。' },
  { id: 'data_analyzer', label: '通用数据分析', status: 'not_implemented', owner: 'registered experiment models', explanation: '通用分析执行器尚未接入；已注册实验的计算仍走原实验模型，不开放任意代码。' },
  { id: 'artifact_review', label: '作品评审', status: 'workflow_owned', owner: 'works / teacher review', explanation: '作品提交与评审由作品及教师服务处理，助手绑定不授予批准作品的权限。' },
  { id: 'growth_record_append', label: '成长记录写入', status: 'workflow_owned', owner: 'growth', explanation: '成长记录由服务端接受有效证据后生成，不允许模型直接追加事实。' },
  { id: 'student_status_summary', label: '学生状态摘要', status: 'workflow_owned', owner: 'feishu reporting / student projection', explanation: '汇报服务提供经过授权与脱敏的学生摘要，不存在同名通用调用工具。' },
  { id: 'parent_status_summary', label: '家长状态摘要', status: 'workflow_owned', owner: 'feishu reporting / parent projection', explanation: '汇报服务提供经过授权与脱敏的家长摘要，不存在同名通用调用工具。' },
  { id: 'teacher_status_summary', label: '教师状态摘要', status: 'workflow_owned', owner: 'feishu reporting / teacher projection', explanation: '汇报服务提供经过授权与脱敏的教师摘要，不存在同名通用调用工具。' },
];

export interface ToolBindingMigrationEntry {
  assistantId: string;
  assistantName: string;
  expectedUpdatedAt: string;
  beforeToolIds: string[];
  afterToolIds: string[];
  retired: LegacyToolBindingResolution[];
}

export interface ToolBindingMigrationPlan {
  policyVersion: 'legacy-tool-bindings.v1';
  revision: string;
  entries: ToolBindingMigrationEntry[];
  unresolvedToolIds: string[];
}

export interface ToolBindingMigrationResult {
  migratedAssistantIds: string[];
  retiredBindingCount: number;
  auditIds: string[];
  remaining: ToolBindingMigrationPlan;
}
