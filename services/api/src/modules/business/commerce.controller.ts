import { Body, Controller, Get, Header, Headers, Param, Patch, Post } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { CommerceService } from './commerce.service';
import { CommerceAccess } from './commerce.access';
import { BusinessService } from './business.service';
@Controller()
export class CommerceController {
  constructor(
    private readonly auth: AuthService,
    private readonly commerce: CommerceService,
    private readonly access: CommerceAccess,
    private readonly business: BusinessService,
  ) {}
  @Get('public/subscriptions')
  @Header('Cache-Control', 'no-store')
  async catalog() {
    return { data: await this.commerce.catalog() };
  }
  @Get('parent/children/:id/subscription')
  @Header('Cache-Control', 'no-store')
  async account(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    const actor = requireRole(this.auth, cookie, 'parent', '请由家长查看孩子权益');
    await this.business.assertGuardian(actor.id, id);
    return { data: await this.access.account(id) };
  }
  @Get('student/subscription')
  @Header('Cache-Control', 'no-store')
  async student(@Headers('cookie') cookie: string | undefined) {
    const actor = requireRole(this.auth, cookie, 'student', '请以学生身份查看权益');
    return { data: await this.access.account(actor.id) };
  }
  @Post('parent/subscriptions/orders')
  async order(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.commerce.createOrder(
        requireRole(this.auth, cookie, 'parent', '请由家长购买'),
        key,
        body,
      ),
    };
  }
  @Patch('admin/subscriptions/products')
  async product(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.commerce.saveProduct(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        key,
        body,
      ),
    };
  }
  @Patch('admin/subscriptions/policy')
  async policy(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.commerce.savePolicy(
        requireRole(this.auth, cookie, 'admin', '需要管理员权限'),
        key,
        body,
      ),
    };
  }
}
