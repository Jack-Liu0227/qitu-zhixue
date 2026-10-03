import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { MasteryModule } from '../mastery/mastery.module';
import { LearningPlanStorageModule } from './learning-plan-storage.module';
import { LearningPlanController } from './learning-plan.controller';
import { LearningPlanService } from './learning-plan.service';
import { DeterministicPlanGenerator, PlanGenerator } from './plan-generator';

@Module({
  imports: [AuthModule, LearningPlanStorageModule, MasteryModule],
  controllers: [LearningPlanController],
  providers: [LearningPlanService, { provide: PlanGenerator, useFactory: () => new DeterministicPlanGenerator() }],
  exports: [LearningPlanService, LearningPlanStorageModule],
})
export class LearningPlanModule {}
