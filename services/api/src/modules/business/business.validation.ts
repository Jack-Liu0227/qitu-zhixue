import { BadRequestException, ConflictException } from '@nestjs/common';
import type { BusinessSettings, SaveProjectOffer, CreateBusinessOrder } from '@qitu/contracts';

export function objectInput(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('请求内容无效');
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(input).some((key) => !fields.includes(key)))
    return invalid('请求包含不支持的字段');
  return input;
}

export function textInput(value: unknown, label: string, max = 300, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    return invalid(`${label}无效`);
  return value.trim();
}

export function integerInput(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    return invalid(`${label}无效`);
  return value;
}

function booleanInput(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid('开关必须为布尔值');
  return value;
}

export const EMPTY_BUSINESS_SETTINGS: BusinessSettings = {
  revision: 0,
  operatorName: '',
  supportEmail: '',
  registrationInfo: '',
  privacyText: '',
  termsText: '',
  refundText: '',
  salesEnabled: false,
  automationEnabled: false,
  followupHours: 24,
  inactivityDays: 7,
};

export function parseBusinessSettings(value: unknown): BusinessSettings {
  const v = objectInput(value, Object.keys(EMPTY_BUSINESS_SETTINGS));
  const settings: BusinessSettings = {
    revision: integerInput(v.revision, '配置版本', 0, 2_000_000_000),
    operatorName: textInput(v.operatorName, '经营主体', 100, false),
    supportEmail: textInput(v.supportEmail, '客服邮箱', 150, false),
    registrationInfo: textInput(v.registrationInfo, '备案与业务说明', 500, false),
    privacyText: textInput(v.privacyText, '隐私说明', 16_000, false),
    termsText: textInput(v.termsText, '服务条款', 16_000, false),
    refundText: textInput(v.refundText, '退款规则', 8_000, false),
    salesEnabled: booleanInput(v.salesEnabled),
    automationEnabled: booleanInput(v.automationEnabled),
    followupHours: integerInput(v.followupHours, '跟进时限', 1, 168),
    inactivityDays: integerInput(v.inactivityDays, '交付关注天数', 1, 90),
  };
  if (settings.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.supportEmail))
    invalid('客服邮箱格式无效');
  if (settings.salesEnabled) assertSalesSettings(settings);
  return settings;
}

export function assertSalesSettings(s: BusinessSettings): void {
  if (
    !s.operatorName ||
    !s.supportEmail ||
    !s.registrationInfo ||
    s.privacyText.length < 40 ||
    s.termsText.length < 40 ||
    s.refundText.length < 20
  ) {
    throw new ConflictException({
      code: 'BUSINESS_NOT_READY',
      message: '请先补充经营主体、客服、业务说明、隐私、服务及退款规则',
    });
  }
}

export function parseOffer(value: unknown): SaveProjectOffer {
  const v = objectInput(value, [
    'id',
    'revision',
    'templateVersionId',
    'title',
    'summary',
    'audience',
    'outcomes',
    'priceFen',
    'accessDays',
    'requiresPurchase',
    'status',
  ]);
  if (!Array.isArray(v.outcomes) || v.outcomes.length < 1 || v.outcomes.length > 8)
    return invalid('请填写一至八项交付成果');
  if (v.status !== 'draft' && v.status !== 'published' && v.status !== 'archived')
    return invalid('商品状态无效');
  return {
    id: textInput(v.id, '商品标识', 100, false),
    revision: integerInput(v.revision, '商品版本', 0, 2_000_000_000),
    templateVersionId: textInput(v.templateVersionId, '课程版本', 150),
    title: textInput(v.title, '项目包名称', 80),
    summary: textInput(v.summary, '项目包介绍', 600),
    audience: textInput(v.audience, '适合人群', 150),
    outcomes: v.outcomes.map((x) => textInput(x, '交付成果', 180)),
    priceFen: integerInput(v.priceFen, '价格', 1, 10_000_000),
    accessDays: integerInput(v.accessDays, '有效天数', 1, 730),
    requiresPurchase: booleanInput(v.requiresPurchase),
    status: v.status,
  };
}

export function parseOrder(value: unknown): CreateBusinessOrder {
  const v = objectInput(value, [
    'offerId',
    'offerRevision',
    'settingsRevision',
    'studentId',
    'acceptedTerms',
    'guardianConsent',
  ]);
  if (v.acceptedTerms !== true || v.guardianConsent !== true)
    return invalid('请阅读条款并确认监护人授权');
  return {
    offerId: textInput(v.offerId, '商品', 100),
    studentId: textInput(v.studentId, '孩子', 100),
    offerRevision: integerInput(v.offerRevision, '商品版本', 1, 2_000_000_000),
    settingsRevision: integerInput(v.settingsRevision, '条款版本', 1, 2_000_000_000),
    acceptedTerms: true,
    guardianConsent: true,
  };
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'BUSINESS_INPUT_INVALID', message });
}
