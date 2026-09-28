import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { LearningStallSignalSink } from './learning-stall-signal';
import { EnvReminderDeliveryGate, ReminderDeliveryGate } from './reminder.gate';
import { ReminderService } from './reminder.service';
import { ReminderStore } from './reminder.types';
import { InMemoryReminderStore } from './reminder.store.memory';
import { RemindersController } from './reminders.controller';

/**
 * 学习进度提醒模块（ISSUE-T2 / #6，安全管线段）。
 *
 * **评审阻塞**：T2 仍为 `Proposed`，通过产品 / 隐私评审（R-T2）前**不得**开启
 * 真实投递。`ReminderDeliveryGate` 默认关闭（`EnvReminderDeliveryGate` 仅在
 * `QITU_REMINDER_DELIVERY_ENABLED=true` **且**已配置数据库能力时放行），
 * 因此本模块默认不下发任何提醒内容。详见 `reminders.md`。
 *
 * **未落库**：当前只提供内存存储（`InMemoryReminderStore`）。在评审通过前不加
 * 数据库迁移——避免在隐私结论未定前把未成年人相关提醒持久化。写操作（关闭 /
 * 重新打开 / 知道了）依赖幂等层，未配置 `DATABASE_URL` 时诚实返回 503。
 *
 * `LearningStallSignalSink` 以 `useExisting` 指向 `ReminderService`：AI 搭档只
 * 依赖这个抽象，不依赖提醒模块实现，两个模块之间没有硬耦合。
 */
@Module({
  imports: [AuthModule],
  controllers: [RemindersController],
  providers: [
    ReminderService,
    { provide: LearningStallSignalSink, useExisting: ReminderService },
    { provide: ReminderStore, useFactory: () => new InMemoryReminderStore() },
    {
      provide: ReminderDeliveryGate,
      useFactory: (db: Database | null): ReminderDeliveryGate =>
        new EnvReminderDeliveryGate(db !== null),
      inject: [DATABASE_TOKEN],
    },
  ],
  exports: [ReminderService, LearningStallSignalSink],
})
export class RemindersModule {}
