import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { BusinessService } from './business.service';
import { BusinessOrders } from './business.orders';
import { BusinessReporting } from './business.reporting';
import { BusinessAutomation } from './business.automation';
import { WechatPayment } from './wechat-payment';
import { FamilyInvitationService } from '../directory/family-invitation.service';
import {
  objectInput,
  parseBusinessSettings,
  parseOffer,
  parseOrder,
  textInput,
  integerInput,
} from './business.validation';

@Controller()
export class BusinessController {
  constructor(
    private readonly auth: AuthService,
    private readonly business: BusinessService,
    private readonly orders: BusinessOrders,
    private readonly reports: BusinessReporting,
    private readonly automation: BusinessAutomation,
    private readonly payment: WechatPayment,
    private readonly invitations: FamilyInvitationService,
  ) {}

  @Post('admin/business/invitations')
  async invite(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return { data: await this.invitations.create(this.admin(cookie), key, body) };
  }

  @Post('public/family-invitations/inspect')
  @Header('Cache-Control', 'no-store')
  async inspectInvitation(@Body() body: unknown) {
    const v = objectInput(body, ['token']);
    return { data: await this.invitations.inspect(textInput(v.token, '邀请', 200)) };
  }

  @Post('public/family-invitations/accept')
  @Header('Cache-Control', 'no-store')
  async acceptInvitation(@Body() body: unknown) {
    return { data: await this.invitations.accept(body) };
  }

  @Get('public/project-offers')
  @Header('Cache-Control', 'no-store')
  async catalog() {
    return { data: await this.business.catalog() };
  }

  @Get('admin/business')
  @Header('Cache-Control', 'no-store')
  async dashboard(@Headers('cookie') cookie?: string) {
    return { data: await this.reports.dashboard(this.admin(cookie)) };
  }

  @Patch('admin/business/settings')
  async settings(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = this.admin(cookie);
    return { data: await this.business.saveSettings(actor, key, parseBusinessSettings(body)) };
  }

  @Post('admin/business/offers')
  async saveOffer(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = this.admin(cookie);
    return { data: await this.business.saveOffer(actor, key, parseOffer(body)) };
  }

  @Patch('admin/business/leads/:id')
  async lead(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = this.admin(cookie);
    const input = objectInput(body, ['status']);
    if (input.status !== 'received' && input.status !== 'contacted' && input.status !== 'closed')
      throw new BadRequestException('线索状态无效');
    return { data: await this.reports.updateLead(actor, key, id, input.status) };
  }

  @Post('admin/business/tasks/:id/resolve')
  async resolve(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
  ) {
    return { data: await this.reports.resolveTask(this.admin(cookie), key, id) };
  }

  @Post('admin/business/check')
  async check(@Headers('cookie') cookie?: string) {
    return { data: await this.automation.run(true, this.admin(cookie)) };
  }

  @Post('admin/business/expenses')
  async expense(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = this.admin(cookie);
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
        amountFen: integerInput(v.amountFen, '成本', 0, 100_000_000),
        minutes: integerInput(v.minutes, '投入分钟', 0, 100_000),
        note: textInput(v.note, '成本说明', 300),
        orderId: v.orderId === null ? null : textInput(v.orderId, '订单标识', 100),
      }),
    };
  }

  @Post('admin/business/orders/:id/refund')
  async refund(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
  ) {
    return { data: await this.orders.approveRefund(this.admin(cookie), id, key) };
  }

  @Get('parent/children/:studentId/orders')
  @Header('Cache-Control', 'no-store')
  async listOrders(@Headers('cookie') cookie: string | undefined, @Param('studentId') id: string) {
    return { data: await this.business.orders(this.parent(cookie), id) };
  }

  @Post('parent/orders')
  async createOrder(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const actor = this.parent(cookie);
    return { data: await this.business.createOrder(actor, key, parseOrder(body)) };
  }

  @Post('parent/orders/:id/checkout')
  async checkout(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
  ) {
    return { data: await this.orders.checkout(this.parent(cookie), id, key) };
  }

  @Post('parent/orders/:id/reconcile')
  async reconcile(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    return { data: await this.orders.reconcile(this.parent(cookie), id) };
  }

  @Post('parent/orders/:id/refund')
  async requestRefund(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = this.parent(cookie);
    const { reason } = objectInput(body, ['reason']);
    return {
      data: await this.orders.requestRefund(actor, id, textInput(reason, '退款原因', 300), key),
    };
  }

  @Post('business/payments/wechat')
  @HttpCode(200)
  async notification(@Req() request: Request & { rawBody?: Buffer }) {
    if (!request.rawBody)
      throw new ServiceUnavailableException({
        code: 'PAYMENT_RAW_BODY_REQUIRED',
        message: '缺少支付原始报文',
      });
    const notification = this.payment.notification(
      request.rawBody.toString('utf8'),
      request.headers,
    );
    if (notification.kind === 'payment') await this.orders.acceptPayment(notification.fact);
    else await this.orders.acceptRefund(notification.fact);
    return { code: 'SUCCESS', message: '成功' };
  }

  private admin(cookie: string | undefined) {
    return requireRole(this.auth, cookie, 'admin', '经营工作区仅向管理员开放');
  }
  private parent(cookie: string | undefined) {
    return requireRole(this.auth, cookie, 'parent', '请使用家长身份管理课程订单');
  }
}
