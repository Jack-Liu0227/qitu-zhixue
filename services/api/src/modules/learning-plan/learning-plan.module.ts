import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { MasteryModule } from '../mastery/mastery.module';
import { TeamRuntimeModule } from '../team-runtime/team-runtime.module';
import { TemplatesModule } from '../templates/templates.module';
import { LearningPlanStorageModule } from './learning-plan-storage.module';
import { LearningPlanController } from './learning-plan.controller';
import { LearningPlanService } from './learning-plan.service';
import { DeterministicPlanGenerator, PlanGenerator } from './plan-generator';

/**
 * 学习计划模块。
 *
 * `TeamRuntimeModule` 提供门禁证据的唯一内部写入通道
 * （`TeamRuntimeService.recordGateForStudent`）。`TheoryMastered` 是四个
 * PBL 门禁里唯一「信号已发出但没有消费者」的一个：本模块在理论达标翻转时
 * 把 `mastery:theory:<sessionId>` 交给该通道，由团队运行时写事件 / 审计 /
 * 待冲刷账本——本模块不自己写门禁表。
 *
 * 依赖是单向的（team-runtime 不依赖 learning-plan），因此无循环导入。
 */
@Module({
  imports: [AuthModule, LearningPlanStorageModule, MasteryModule, TeamRuntimeModule, TemplatesModule],
  controllers: [LearningPlanController],
  providers: [LearningPlanService, { provide: PlanGenerator, useFactory: () => new DeterministicPlanGenerator() }],
  exports: [LearningPlanService, LearningPlanStorageModule],
})
export class LearningPlanModule {}
