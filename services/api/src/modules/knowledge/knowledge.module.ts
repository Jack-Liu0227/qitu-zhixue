import { TemplatesModule } from '../templates/templates.module';
import { Module, forwardRef } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeAdminController } from './knowledge-admin.controller';
import { EmbeddingProvider, ReservedEmbeddingProvider } from './knowledge.embedding.port';
import { KeywordRetrievalPort, RetrievalPort } from './knowledge.retrieval.port';
import {
  DefaultKnowledgeScopeAuthorizer,
  DemoKnowledgeDirectory,
  KnowledgeDirectoryPort,
  KnowledgeScopeAuthorizer,
  PostgresKnowledgeDirectory,
} from './knowledge.scope-authorizer';
import { KnowledgeService } from './knowledge.service';
import { InMemoryKnowledgeStore, KnowledgeStore } from './knowledge.store';
import { PostgresKnowledgeStore } from './knowledge.store.postgres';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { KnowledgeCenterController } from './knowledge-center.controller';
import { KnowledgeCenterService } from './knowledge-center.service';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { KnowledgeBuildWorker } from './knowledge-build.worker';
import { KnowledgeSourceSyncService } from './knowledge-source-sync.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeRetrievalController } from './knowledge-retrieval.controller';
import { KnowledgeToolCatalogService } from './knowledge-tool-catalog.service';
import { KnowledgeUploadService } from './knowledge-upload.service';
import { KnowledgeConnectionService } from './knowledge-connection.service';
import { KnowledgeLinkProbeService } from './knowledge-link-probe.service';
import { KnowledgeLibraryService } from './knowledge-library.service';
import { KnowledgeMatrixService } from './knowledge-matrix.service';
import { KnowledgeConnectionCheckService } from './knowledge-connection-check.service';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';

/**
 * 作用域知识模块。
 *
 * 引擎选择（与 `ProjectsModule` / `DirectoryService` 一致的双引擎模式）：
 * - 有数据库连接 → PostgreSQL 实现（canonical `knowledge_documents` / `knowledge_chunks`）；
 * - 无数据库且非 `live` → 内存实现（仅 demo / test）；
 * - `live` 却无连接 → 抛错 fail fast，绝不退化成内存假装持久化。
 *
 * `AuditModule` / `IdempotencyModule` / `AccessModule` 均为 `@Global()`，直接注入
 * 其抽象即可。`EmbeddingProvider` 当前绑定为 `ReservedEmbeddingProvider`
 * （`knowledge.embed` 未接入 ModelGateway），仅作为接口预留，不参与关键词检索。
 */
@Module({
  imports: [
    forwardRef(() => TemplatesModule),
    AuthModule,
    ModelRegistryModule,
    forwardRef(() => PlatformRegistryModule),
  ],
  controllers: [
    KnowledgeController,
    KnowledgeAdminController,
    KnowledgeCenterController,
    KnowledgeRetrievalController,
  ],
  providers: [
    KnowledgeMatrixService,
    KnowledgeConnectionCheckService,
    KnowledgeUploadService,
    KnowledgeLibraryService,
    KnowledgeConnectionService,
    KnowledgeLinkProbeService,
    KnowledgeSourceSyncService,
    KnowledgeToolCatalogService,
    KnowledgeCenterService,
    KnowledgeEngineService,
    KnowledgeBuildWorker,
    KnowledgeRetrievalService,
    KnowledgeService,
    { provide: RetrievalPort, useClass: KeywordRetrievalPort },
    { provide: EmbeddingProvider, useClass: ReservedEmbeddingProvider },
    {
      provide: KnowledgeStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): KnowledgeStore => {
        if (db !== null) return new PostgresKnowledgeStore(db);
        if (mode === 'live') {
          // DatabaseModule 已 fail fast；这里再挡一层，避免误配后静默丢数据。
          throw new Error('live 模式缺少 DATABASE_URL：知识存储不可用');
        }
        return new InMemoryKnowledgeStore();
      },
    },
    {
      provide: KnowledgeDirectoryPort,
      inject: [DATABASE_TOKEN],
      useFactory: (db: Database | null): KnowledgeDirectoryPort => {
        if (db !== null) return new PostgresKnowledgeDirectory(db);
        return new DemoKnowledgeDirectory();
      },
    },
    { provide: KnowledgeScopeAuthorizer, useClass: DefaultKnowledgeScopeAuthorizer },
  ],
  exports: [
    KnowledgeConnectionService,
    KnowledgeUploadService,
    KnowledgeLibraryService,
    KnowledgeEngineService,
    KnowledgeToolCatalogService,
    KnowledgeService,
    RetrievalPort,
    EmbeddingProvider,
    KnowledgeCenterService,
    KnowledgeRetrievalService,
  ],
})
export class KnowledgeModule {}
