import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { companyMembers, users } from '@qitu/database';
import type { CompanyRole, CurrentUser } from '@qitu/contracts';
import { BusinessStore } from '../business/business.store';
@Injectable()
export class CompanyAccess {
  constructor(private readonly store: BusinessStore) {}
  async require(
    actor: CurrentUser,
    capability: 'read' | 'operate' | 'manage' = 'read',
  ): Promise<CompanyRole> {
    const [user] = await this.store
      .database()
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, actor.id), isNull(users.disabledAt)));
    if (!user || user.role === 'student')
      throw new ForbiddenException({
        code: 'COMPANY_ACCESS_DENIED',
        message: '此账号没有公司工作区权限',
      });
    const [member] = await this.store
      .database()
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, actor.id), eq(companyMembers.active, true)));
    const role = user.role === 'admin' && actor.role === 'admin' ? 'owner' : member?.role;
    if (
      !role ||
      (capability === 'operate' && !['owner', 'operator'].includes(role)) ||
      (capability === 'manage' && role !== 'owner')
    )
      throw new ForbiddenException({
        code: 'COMPANY_ACCESS_DENIED',
        message: '当前公司角色不允许此操作',
      });
    return role;
  }
}
