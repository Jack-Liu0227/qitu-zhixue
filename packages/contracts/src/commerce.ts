export type CommerceKind = 'trial' | 'month' | 'year' | 'pilot' | 'institution' | 'school';
export interface CommerceProduct {
  id: CommerceKind;
  revision: number;
  title: string;
  summary: string;
  priceFen: number;
  seatPriceFen: number;
  seats: number;
  days: number;
  months: number;
  quota: number;
  projectLimit: number | null;
  templateVersionIds: string[];
  status: 'draft' | 'published' | 'conditional' | 'archived';
}
export interface CommercePolicy {
  revision: number;
  enabled: boolean;
  freeTemplateVersionIds: string[];
}
export interface CommerceCatalog {
  products: CommerceProduct[];
  policy: CommercePolicy;
  settingsRevision: number;
  purchasing: { available: boolean; reason: string };
}
export interface CommerceOrderSnapshot {
  product: CommerceProduct;
  seats: number;
  originalAmountFen: number;
  discountFen: number;
  discountOrderId: string | null;
  organizationId: string | null;
}
export interface CommerceEntitlement {
  id: string;
  studentId: string;
  title: string;
  source: CommerceKind | 'free';
  organizationId: string | null;
  startsAt: string;
  endsAt: string;
  quota: number;
  used: number;
  reserved: number;
  resetsAt: string;
  templateVersionIds: string[];
  projectLimit: number | null;
  projectsUsed: number;
}
export interface CommerceAccount {
  studentId: string;
  enabled: boolean;
  entitlements: CommerceEntitlement[];
  trialDiscountFen: number;
  trialPurchased: boolean;
  generatedAt: string;
}
export interface CommerceCreateOrder {
  productId: CommerceKind;
  productRevision: number;
  settingsRevision: number;
  studentId?: string;
  organizationId?: string;
  seats?: number;
  acceptedTerms: true;
  guardianConsent: true;
}
export const COMMERCE_DEFAULT_PRODUCTS: CommerceProduct[] = [
  {
    id: 'trial',
    revision: 0,
    title: 'AI 探究体验课',
    summary: '独立短探究 · 7 天有效 · 每生限购一次',
    priceFen: 990,
    seatPriceFen: 0,
    seats: 1,
    days: 7,
    months: 0,
    quota: 100,
    projectLimit: 1,
    templateVersionIds: [],
    status: 'draft',
  },
  {
    id: 'month',
    revision: 0,
    title: '成长会员·月卡',
    summary: '会员目录不限项目数量 · 每周期 1500 次有效 AI 交互 · 手动续费',
    priceFen: 39900,
    seatPriceFen: 0,
    seats: 1,
    days: 0,
    months: 1,
    quota: 1500,
    projectLimit: null,
    templateVersionIds: [],
    status: 'draft',
  },
  {
    id: 'year',
    revision: 0,
    title: '成长会员·年卡',
    summary: '条件性方案，确认业务分类与收款安排后开放',
    priceFen: 429900,
    seatPriceFen: 0,
    seats: 1,
    days: 0,
    months: 12,
    quota: 1500,
    projectLimit: null,
    templateVersionIds: [],
    status: 'conditional',
  },
  {
    id: 'pilot',
    revision: 0,
    title: '机构试点包',
    summary: '30 天 · 30 名学生 · 1 个指定项目 · 每生 100 次课内交互',
    priceFen: 298000,
    seatPriceFen: 0,
    seats: 30,
    days: 30,
    months: 0,
    quota: 100,
    projectLimit: 1,
    templateVersionIds: [],
    status: 'draft',
  },
  {
    id: 'institution',
    revision: 0,
    title: '机构标准版',
    summary: '年度报价与付款周期分别约定，50 人起',
    priceFen: 1980000,
    seatPriceFen: 99900,
    seats: 50,
    days: 0,
    months: 12,
    quota: 300,
    projectLimit: 6,
    templateVersionIds: [],
    status: 'conditional',
  },
  {
    id: 'school',
    revision: 0,
    title: '学校版',
    summary: '年度报价与付款周期分别约定，200 人起',
    priceFen: 3980000,
    seatPriceFen: 39900,
    seats: 200,
    days: 0,
    months: 12,
    quota: 100,
    projectLimit: 4,
    templateVersionIds: [],
    status: 'conditional',
  },
];
