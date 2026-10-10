import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { TeacherService } from './teacher.service';
import {
  InMemoryTeacherReviewRepository,
  PostgresTeacherReviewRepository,
  TeacherReviewRepository,
} from './teacher.service';
import { TeacherController } from './teacher.controller';
import { DirectoryModule } from '../directory/directory.module';
import { AuthModule } from '../identity-auth/auth.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { TeamRuntimeModule } from '../team-runtime/team-runtime.module';

/**
 * 班主任工作台模块。
 *
 * `TeacherReviewRepository` 的引擎选择与 `WorksModule` / `FeedbackModule` 同构，
 * 且**必须**与之一致：`mentor_reviews.status='approved'` 是作品发布
 * （`review_completed_and_archived` 门禁）的唯一复核证据来源，一旦在 live
 * 退化成内存存储，就会造成「批复只在单个进程里存在、学生重发就 404」的假成功。
 * 因此：
 * - 有数据库连接 → `PostgresTeacherReviewRepository`（写库 + 审计同一事务）；
 * - 无数据库且非 `live` → `InMemoryTeacherReviewRepository`（仅 demo / test）；
 * - `live` 却没有连接 → 直接抛错，绝不静默退化。
 *
 * `AuditWriter` / `IdempotencyStore` 由 `@Global()` 横切模块提供，这里不再 import。
 */
@Module({
  imports: [DirectoryModule, AuthModule, FeedbackModule, PlatformDataModule, TeamRuntimeModule],
  controllers: [TeacherController],
  providers: [
    TeacherService,
    {
      provide: TeacherReviewRepository,
      inject: [DATABASE_TOKEN, AuditWriter, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, audit: AuditWriter, mode: DataMode): TeacherReviewRepository => {
        if (db !== null) return new PostgresTeacherReviewRepository(db, audit);
        if (mode === 'live') {
          // DatabaseModule 理论上已 fail-fast；这里再挡一层，避免误配后批复不落库。
          throw new Error('live 模式缺少 DATABASE_URL：复核审批存储不可用');
        }
        return new InMemoryTeacherReviewRepository(audit);
      },
    },
  ],
  exports: [TeacherService, TeacherReviewRepository],
})
export class TeacherModule {}
