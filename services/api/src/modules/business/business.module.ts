import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { DirectoryModule } from '../directory/directory.module';
import { BusinessController } from './business.controller';
import { BusinessStore } from './business.store';
import { BusinessService } from './business.service';
import { BusinessOrders } from './business.orders';
import { BusinessReporting } from './business.reporting';
import { BusinessAutomation } from './business.automation';
import { BusinessUsage } from './business.usage';
import { BusinessAccess } from './business.access';
import { WechatPayment } from './wechat-payment';
import { FamilyInvitationService } from '../directory/family-invitation.service';

@Global()
@Module({
  imports: [AuthModule, DirectoryModule],
  controllers: [BusinessController],
  providers: [
    BusinessStore,
    BusinessService,
    BusinessOrders,
    BusinessReporting,
    BusinessAutomation,
    BusinessUsage,
    BusinessAccess,
    WechatPayment,
    FamilyInvitationService,
  ],
  exports: [BusinessUsage, BusinessAccess],
})
export class BusinessModule {}
