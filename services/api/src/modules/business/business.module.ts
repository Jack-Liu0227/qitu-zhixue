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
import { AccountRegistrationService } from '../directory/account-registration.service';
import { RegistrationSmsService } from '../directory/registration-sms.service';
import { AliyunRegistrationSms } from '../directory/aliyun-registration-sms';
import { CommerceService } from './commerce.service';
import { CommerceAccess } from './commerce.access';
import { CommerceController } from './commerce.controller';

@Global()
@Module({
  imports: [AuthModule, DirectoryModule],
  controllers: [BusinessController, CommerceController],
  providers: [
    BusinessStore,
    BusinessService,
    BusinessOrders,
    BusinessReporting,
    BusinessAutomation,
    BusinessUsage,
    BusinessAccess,
    WechatPayment,
    AccountRegistrationService,
    RegistrationSmsService,
    AliyunRegistrationSms,
    CommerceService,
    CommerceAccess,
  ],
  exports: [BusinessUsage, BusinessAccess, BusinessStore, BusinessService, BusinessOrders, BusinessReporting, CommerceService, CommerceAccess],
})
export class BusinessModule {}
