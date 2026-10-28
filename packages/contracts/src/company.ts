export type CompanyRole = 'owner' | 'operator' | 'analyst' | 'viewer';
export const COMPANY_DEPARTMENTS = [
  { id: 'management', name: '经营管理', mission: '汇总经营事实、识别阻塞、提出今日行动与责任分工' },
  {
    id: 'product',
    name: '产品与体验',
    mission: '整理需求、制定产品验收标准、提出可验证的改进方案',
  },
  { id: 'data', name: '数据分析', mission: '按明确口径分析收入、转化、交付、用量与成本缺口' },
  { id: 'success', name: '客户成功', mission: '识别交付和退款待办，起草客户服务方案' },
  { id: 'growth', name: '市场增长', mission: '设计获客实验和内容草稿，不自动对外发布' },
  { id: 'sales', name: '销售与机构', mission: '制定机构试点、跟进和交付方案，不承诺未发布权益' },
  {
    id: 'curriculum',
    name: '课程与教研',
    mission: '提出课程质量与内容改进，不改变学生掌握或教学门禁',
  },
  { id: 'finance', name: '财务与采购', mission: '核对收入、退款、记录成本与预算，不执行资金操作' },
  {
    id: 'engineering',
    name: '研发与质量',
    mission: '起草技术方案、测试和发布检查，不执行任意代码',
  },
  { id: 'operations', name: '运行维护', mission: '分析运行异常、制定排查和恢复建议' },
  { id: 'risk', name: '合规与风险', mission: '整理待核实事项和资料，标明未验证结论' },
  { id: 'knowledge', name: '行政与知识', mission: '整理公司流程、决策和可复用知识草稿' },
] as const;
export type CompanyDepartment = (typeof COMPANY_DEPARTMENTS)[number]['id'];
export interface CompanyWork {
  id: string;
  title: string;
  department: CompanyDepartment;
  brief: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}
export interface CompanyTeam {
  department: CompanyDepartment;
  assistantId: string | null;
  enabled: boolean;
  revision: number;
}
export interface CompanyOverview {
  dataMode: import('./index.js').DataMode;
  role: CompanyRole;
  actor: { id: string; name: string; admin: boolean };
  generatedAt: string;
  metrics: {
    students: number;
    parents: number;
    teachers: number;
    projects: number;
    completedProjects: number;
    orders: number;
    paidOrders: number;
    revenueFen: number;
    refundedFen: number;
    expenseFen: number;
    aiCalls: number;
    unknownUsage: number;
    activeMembers: number;
    organizations: number;
    pendingWork: number;
  };
  daily: { day: string; revenueFen: number; orders: number }[];
  catalog: import('./commerce.js').CommerceCatalog;
  teams: CompanyTeam[];
  assistants: { id: string; name: string; enabled: boolean }[];
  templates: { id: string; title: string; version: string }[];
  payment: { configured: boolean; reason: string };
  work: CompanyWork[];
}
