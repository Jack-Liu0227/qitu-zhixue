/** Commercial access never writes learning stages, mastery or assessment results. */
export interface BusinessSettings {
  revision: number;
  operatorName: string;
  supportEmail: string;
  registrationInfo: string;
  privacyText: string;
  termsText: string;
  refundText: string;
  salesEnabled: boolean;
  automationEnabled: boolean;
  followupHours: number;
  inactivityDays: number;
}

export interface ProjectOffer {
  id: string;
  revision: number;
  templateVersionId: string;
  title: string;
  summary: string;
  audience: string;
  outcomes: string[];
  priceFen: number;
  accessDays: number;
  requiresPurchase: boolean;
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
}

export type SaveProjectOffer = Omit<ProjectOffer, 'publishedAt'>;

export interface BusinessCatalog {
  offers: ProjectOffer[];
  operator: Pick<
    BusinessSettings,
    | 'operatorName'
    | 'supportEmail'
    | 'registrationInfo'
    | 'privacyText'
    | 'termsText'
    | 'refundText'
    | 'revision'
  >;
  purchasing: { available: boolean; reason: string };
}

export type BusinessOrderStatus =
  'pending' | 'paid' | 'refund_requested' | 'refunding' | 'refunded' | 'cancelled';

export interface BusinessOrder {
  id: string;
  studentId: string | null;
  offer: ProjectOffer | null;
  subscription?: import('./commerce.js').CommerceOrderSnapshot | null;
  serviceStartsAt?: string | null;
  refundAmountFen?: number | null;
  amountFen: number;
  status: BusinessOrderStatus;
  createdAt: string;
  paidAt: string | null;
  accessUntil: string | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: string;
  refundReason: string | null;
  /** Only an authorized parent receives their frozen contractual terms. */
  terms: Pick<
    BusinessSettings,
    'operatorName' | 'supportEmail' | 'privacyText' | 'termsText' | 'refundText' | 'revision'
  >;
}

export interface CreateBusinessOrder {
  offerId: string;
  offerRevision: number;
  settingsRevision: number;
  studentId: string;
  acceptedTerms: true;
  guardianConsent: true;
}

export interface BusinessTask {
  id: string;
  kind: 'lead' | 'refund' | 'delivery';
  referenceId: string;
  title: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface BusinessLead {
  id: string;
  name: string;
  phone: string;
  identity: string;
  message: string | null;
  status: 'received' | 'contacted' | 'closed';
  createdAt: string;
}

export interface BusinessExpense {
  id: string;
  category: 'ai' | 'payment' | 'hosting' | 'support' | 'other';
  amountFen: number;
  minutes: number;
  note: string;
  orderId: string | null;
  createdAt: string;
}
export type CreateBusinessExpense = Omit<BusinessExpense, 'id' | 'createdAt'>;

export interface BusinessDashboard {
  settings: BusinessSettings;
  offers: ProjectOffer[];
  templates: { id: string; title: string; version: string }[];
  payment: { configured: boolean; provider: 'wechat-native'; reason: string };
  metrics: {
    orders: number;
    paidOrders: number;
    refundOrders: number;
    revenueFen: number;
    refundedFen: number;
    learningStarted: number;
    learningCompleted: number;
    repeatBuyers: number;
    consultations: number;
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    unknownUsageCalls: number;
    recordedExpenseFen: number;
    supportMinutes: number;
  };
  recentOrders: Omit<BusinessOrder, 'terms' | 'checkoutUrl'>[];
  leads: BusinessLead[];
  tasks: BusinessTask[];
  expenses: BusinessExpense[];
  automation: { lastRunAt: string | null; enabled: boolean };
  generatedAt: string;
}

export function businessOrderLabel(status: BusinessOrderStatus): string {
  switch (status) {
    case 'pending':
      return '待支付';
    case 'paid':
      return '已开通';
    case 'refund_requested':
      return '已申请退款';
    case 'refunding':
      return '退款处理中';
    case 'refunded':
      return '已退款';
    case 'cancelled':
      return '已关闭';
  }
}

export function formatBusinessMoney(fen: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(fen / 100);
}
