import { Module } from '@nestjs/common';
import { AccessModule } from '../../common/access/access.module';
import { AuthModule } from '../identity-auth/auth.module';
import { LearningPlanStorageModule } from '../learning-plan/learning-plan-storage.module';
import { MasteryController } from './mastery.controller';
import { MasteryReadService } from './mastery.service';
import { MasteryDomainService } from './mastery-domain.service';

@Module({
  imports: [AccessModule, AuthModule, LearningPlanStorageModule],
  controllers: [MasteryController],
  providers: [MasteryReadService, MasteryDomainService],
  exports: [MasteryReadService, MasteryDomainService],
})
export class MasteryModule {}
