import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { companyKnowledge, companyMembers, users } from '@qitu/database';
import type { CompanyRole } from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { requireAnyRole, requireRole } from '../../common/access/request-auth';
import { CompanyAccess } from './company.access';
import { CompanyData } from './company.data';
import { CompanyWorkService } from './company.work';
import { BusinessStore } from '../business/business.store';
import { BusinessOrders } from '../business/business.orders';
import { BusinessReporting } from '../business/business.reporting';
import { CommerceService } from '../business/commerce.service';
import { integerInput, objectInput, textInput } from '../business/business.validation';
import { CompanyIntegrations } from './company.integrations';

@Controller('company')
export class CompanyController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: CompanyAccess,
    private readonly data: CompanyData,
    private readonly work: CompanyWorkService,
    private readonly commerce: CommerceService,
    private readonly store: BusinessStore,
    private readonly reports: BusinessReporting,
    private readonly orders: BusinessOrders,
    private readonly integrations: CompanyIntegrations,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async overview(@Headers('cookie') cookie?: string) {
    return { data: await this.data.overview(requireAnyRole(this.auth, cookie)) };
  }
  @Post('work')
  async createWork(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return { data: await this.work.create(requireAnyRole(this.auth, cookie), key, body) };
  }
  @Patch('work/:id')
  async updateWork(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { data: await this.work.change(requireAnyRole(this.auth, cookie), key, id, body) };
  }
  @Patch('teams')
  async team(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return { data: await this.work.configure(requireAnyRole(this.auth, cookie), key, body) };
  }
  @Get('finance')
  @Header('Cache-Control', 'no-store')
  async finance(@Headers('cookie') cookie?: string) {
    const actor = requireAnyRole(this.auth, cookie);
    await this.access.require(actor, 'operate');
    return { data: await this.reports.dashboard(actor) };
  }
  @Get('organizations')
  @Header('Cache-Control', 'no-store')
  async organizations(@Headers('cookie') cookie?: string) {
    const actor = requireAnyRole(this.auth, cookie);
    await this.access.require(actor, 'operate');
    const [organizations, report] = await Promise.all([
      this.commerce.organizations(),
      this.reports.dashboard(actor),
    ]);
    return { data: { ...organizations, leads: report.leads } };
  }
  @Patch('leads/:id')
  async lead(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = requireAnyRole(this.auth, cookie);
    await this.access.require(actor, 'operate');
    const v = objectInput(body, ['status']);
    if (v.status !== 'received' && v.status !== 'contacted' && v.status !== 'closed')
      throw new BadRequestException('线索状态无效');
    return { data: await this.reports.updateLead(actor, key, id, v.status) };
  }
  @Post('expenses')
  async expense(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = requireAnyRole(this.auth, cookie);
    await this.access.require(actor, 'operate');
    const v = objectInput(body, ['category', 'amountFen', 'minutes', 'note', 'orderId']);
    if (
      v.category !== 'ai' &&
      v.category !== 'payment' &&
      v.category !== 'hosting' &&
      v.category !== 'support' &&
      v.category !== 'other'
    )
      throw new BadRequestException('成本类别无效');
    return {
      data: await this.reports.recordExpense(actor, key, {
        category: v.category,
        amountFen: integerInput(v.amountFen, '金额', 0, 100_000_000),
        minutes: integerInput(v.minutes, '分钟', 0, 100_000),
        note: textInput(v.note, '说明', 300),
        orderId: v.orderId === null ? null : textInput(v.orderId, '关联订单', 100),
      }),
    };
  }
  @Post('orders/:id/refund-request')
  async requestOrganizationRefund(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', '需要管理员权限');
    const v = objectInput(body, ['reason']);
    return {
      data: await this.orders.requestRefund(actor, id, textInput(v.reason, '退款原因', 300), key),
    };
  }
  @Post('organizations')
  async organization(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.commerce.createOrganization(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        key,
        body,
      ),
    };
  }
  @Post('orders')
  async organizationOrder(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.commerce.createOrder(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        key,
        body,
      ),
    };
  }
  @Post('seats')
  async seat(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.commerce.assignSeat(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        key,
        body,
      ),
    };
  }
  @Post('orders/:id/checkout')
  async checkout(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
  ) {
    return {
      data: await this.orders.checkout(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        id,
        key,
      ),
    };
  }
  @Post('orders/:id/reconcile')
  async reconcile(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    return {
      data: await this.orders.reconcile(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        id,
      ),
    };
  }
  @Post('orders/:id/refund')
  async refund(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
  ) {
    return {
      data: await this.orders.approveRefund(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        id,
        key,
      ),
    };
  }
  @Get('knowledge')
  @Header('Cache-Control', 'no-store')
  async knowledge(@Headers('cookie') cookie?: string) {
    await this.access.require(requireAnyRole(this.auth, cookie));
    return {
      data: await this.store
        .database()
        .select()
        .from(companyKnowledge)
        .orderBy(desc(companyKnowledge.updatedAt))
        .limit(200),
    };
  }
  @Post('knowledge')
  async saveKnowledge(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = requireAnyRole(this.auth, cookie);
    await this.access.require(actor, 'operate');
    const v = objectInput(body, ['id', 'title', 'content', 'revision']);
    const id = v.id ? textInput(v.id, '知识标识', 100) : randomUUID();
    const revision = integerInput(v.revision, '版本', 0, 2_000_000_000),
      title = textInput(v.title, '标题', 160),
      content = textInput(v.content, '内容', 20000);
    return {
      data: await this.store.mutate(actor, key, 'company.knowledge.save', body, async (tx) => {
        await this.store.lockSettings(tx);
        const [prior] = await tx.select().from(companyKnowledge).where(eq(companyKnowledge.id, id));
        if ((prior?.revision ?? 0) !== revision || (v.id && !prior))
          throw new BadRequestException('知识版本已变化，请刷新');
        const value = {
          id,
          title,
          content,
          revision: revision + 1,
          updatedBy: actor.id,
          updatedAt: new Date(),
        };
        await tx
          .insert(companyKnowledge)
          .values(value)
          .onConflictDoUpdate({ target: companyKnowledge.id, set: value });
        return value;
      }),
    };
  }
  @Get('members')
  @Header('Cache-Control', 'no-store')
  async members(@Headers('cookie') cookie?: string) {
    await this.access.require(requireAnyRole(this.auth, cookie), 'manage');
    return {
      data: await this.store
        .database()
        .select({
          userId: companyMembers.userId,
          role: companyMembers.role,
          active: companyMembers.active,
          name: users.displayName,
        })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId)),
    };
  }
  @Patch('members')
  async member(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = requireAnyRole(this.auth, cookie);
    await this.access.require(actor, 'manage');
    const v = objectInput(body, ['userId', 'role', 'active']);
    const userId = textInput(v.userId, '用户', 100);
    if (
      !['owner', 'operator', 'analyst', 'viewer'].includes(String(v.role)) ||
      typeof v.active !== 'boolean'
    )
      throw new BadRequestException('成员角色无效');
    return {
      data: await this.store.mutate(actor, key, 'company.member.save', body, async (tx) => {
        const [user] = await tx
          .select({ role: users.role })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.disabledAt)));
        if (!user || user.role === 'student')
          throw new BadRequestException('请选择有效的非学生账号');
        const value = { userId, role: v.role as CompanyRole, active: v.active as boolean };
        await tx
          .insert(companyMembers)
          .values(value)
          .onConflictDoUpdate({ target: companyMembers.userId, set: value });
        return value;
      }),
    };
  }
  @Get('integrations')
  @Header('Cache-Control', 'no-store')
  async channels(@Headers('cookie') cookie?: string) {
    return { data: await this.integrations.list(requireAnyRole(this.auth, cookie)) };
  }
  @Post('integrations/feishu')
  async channel(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return { data: await this.integrations.bind(requireAnyRole(this.auth, cookie), key, body) };
  }
}
