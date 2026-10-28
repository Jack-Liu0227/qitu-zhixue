import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { FeishuModule } from '../feishu/feishu.module';
import { CompanyAccess } from './company.access';
import { CompanyData } from './company.data';
import { CompanyWorkService } from './company.work';
import { CompanyController } from './company.controller';
import { CompanyIntegrations } from './company.integrations';
@Module({
  imports: [AuthModule, ModelRegistryModule, PlatformRegistryModule, FeishuModule],
  controllers: [CompanyController],
  providers: [CompanyAccess, CompanyData, CompanyWorkService, CompanyIntegrations],
})
export class CompanyModule {}
