import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { TemplateEvidenceSource, TemplateViewerDirectory } from './template-evidence.store';
import { InMemoryTemplateEvidenceSource, InMemoryTemplateViewerDirectory } from './template-evidence.store';
import { PostgresTemplateEvidenceSource, PostgresTemplateViewerDirectory } from './template-evidence.store.postgres';
import { TemplateGovernanceController } from './templates-governance.controller';
import { TemplateGovernanceService } from './templates-governance.service';
import { TemplateStore, InMemoryTemplateStore } from './templates.store';
import { PostgresTemplateStore } from './templates.store.postgres';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * 共享可验证项目模板库模块（产品文档 7.4 / ADR 0006）。
 *
 * 存储引擎按数据模式选择，与 `ProjectsModule` / `DirectoryService` 一致：
 * - 有数据库连接（`live` 必然有）→ PostgreSQL 实现；
 * - 无数据库且非 `live` → 内存实现（仅测试 / 演示）；
 * - `live` 却没有连接 → fail fast，绝不退化成内存假装持久化。
 *
 * `IdempotencyStore` / `AuditWriter` 由 `@Global()` 模块提供；这里直接注入抽象。
 *
 * 已知前提：当前 schema 只有 `project_templates` / `project_template_versions`；
 * `template_verification_runs` / `template_verification_evidence` 尚未迁移。因此
 * 验证评测是**确定性纯函数**，副作用只落在版本状态迁移 + 幂等记录 + 审计
 * （见最终交接说明），不写未迁移的验证表。
 */
@Module({
  imports: [AuthModule],
  controllers: [TemplatesController, TemplateGovernanceController],
  providers: [
    TemplatesService,
    TemplateGovernanceService,
    {
      provide: TemplateStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): TemplateStore => {
        if (db !== null) return new PostgresTemplateStore(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：模板存储不可用');
        }
        return new InMemoryTemplateStore();
      },
    },
    {
      provide: TemplateEvidenceSource,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): TemplateEvidenceSource => {
        if (db !== null) return new PostgresTemplateEvidenceSource(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：模板验证证据不可用');
        }
        return new InMemoryTemplateEvidenceSource();
      },
    },
    {
      provide: TemplateViewerDirectory,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): TemplateViewerDirectory => {
        if (db !== null) return new PostgresTemplateViewerDirectory(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：模板作用域目录不可用');
        }
        return new InMemoryTemplateViewerDirectory();
      },
    },
  ],
  exports: [TemplatesService, TemplateGovernanceService],
})
export class TemplatesModule {}
