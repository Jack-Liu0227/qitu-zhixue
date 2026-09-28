import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { AuthModule } from '../identity-auth/auth.module';
import { DATABASE_TOKEN } from '../../database';
import { AccountPreferencesController } from './account-preferences.controller';
import { AccountPreferencesService } from './account-preferences.service';
import { PostgresPreferenceStore } from './account-preferences.store';
import { PreferenceStore } from './account-preferences.types';

/**
 * 跨角色账号能力模块（ISSUE-T4 / #9）。
 *
 * 当前只承载基础偏好：字号 / 预设主题 / 减弱动效 / 通知开关。账号与安全等
 * 其余账号能力在各自模块就绪后挂到同一 `account` 顶层路径下。
 *
 * 存储：`PreferenceStore` 抽象类作为注入令牌，仅在配置了 `DATABASE_URL`
 * （`DATABASE_TOKEN` 非空）时提供 Postgres 实现，否则提供 `null`，由
 * `AccountPreferencesService` 诚实返回 503——不退回内存假装成功。
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountPreferencesController],
  providers: [
    AccountPreferencesService,
    {
      provide: PreferenceStore,
      useFactory: (db: Database | null): PreferenceStore | null =>
        db === null ? null : new PostgresPreferenceStore(db),
      inject: [DATABASE_TOKEN],
    },
  ],
  exports: [AccountPreferencesService],
})
export class AccountModule {}
