import { Module } from '@nestjs/common';
import { type Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { DirectoryModule } from '../directory/directory.module';
import { DirectoryService } from '../directory/directory.service';
import { ArtifactsController, FilesController } from './works.controller';
import { ProjectEvidenceController } from './project-evidence.controller';
import { WorksService } from './works.service';
import {
  DirectoryWorksDirectory,
  WorksDirectory,
} from './works.access';
import { InMemoryWorksStore, WorksStore } from './works.store';
import { PostgresWorksStore } from './works.store.postgres';
import { InMemoryWorksProjectReader, PostgresWorksProjectReader, WorksProjectReader } from './works.project-reader';
import {
  EmptyProjectEvidenceSource,
  InMemoryProjectEvidenceStore,
  ProjectEvidenceSource,
  ProjectEvidenceStore,
} from './project-evidence.store';
import {
  PostgresProjectEvidenceStore,
  TutorTurnProjectEvidenceSource,
} from './project-evidence.store.postgres';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import {
  InMemoryObjectStoragePresigner,
  ObjectStoragePresigner,
  UnconfiguredObjectStoragePresigner,
} from './object-storage.presigner';

/**
 * 作品 / 证据模块（Works）。
 *
 * 存储引擎按数据模式选择，与 `DirectoryService` / `ProjectsModule` 一致：
 * - 有数据库连接 → Postgres 实现；
 * - 无数据库且非 live → 内存实现（仅 demo / test）；
 * - live 无连接 → 抛错，绝不静默退化成内存。
 *
 * 对外导出 `ProjectEvidenceMaterializer`，供任务提交 / AI turn / 升级 / 反思 /
 * 判分等服务端模块物化证据（这是**唯一**的证据写入口，没有 HTTP 路由）。
 */
@Module({
  imports: [AuthModule, DirectoryModule],
  controllers: [ArtifactsController, FilesController, ProjectEvidenceController],
  providers: [
    WorksService,
    ProjectEvidenceMaterializer,
    {
      provide: WorksStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): WorksStore => {
        if (db !== null) return new PostgresWorksStore(db);
        if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：作品存储不可用');
        return new InMemoryWorksStore();
      },
    },
    {
      provide: WorksProjectReader,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): WorksProjectReader => {
        if (db !== null) return new PostgresWorksProjectReader(db);
        if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：项目只读端口不可用');
        return new InMemoryWorksProjectReader();
      },
    },
    {
      provide: ProjectEvidenceStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): ProjectEvidenceStore => {
        if (db !== null) return new PostgresProjectEvidenceStore(db);
        if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：项目证据存储不可用');
        return new InMemoryProjectEvidenceStore();
      },
    },
    {
      provide: ProjectEvidenceSource,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): ProjectEvidenceSource => {
        if (db !== null) return new TutorTurnProjectEvidenceSource(db);
        if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：项目证据来源不可用');
        return new EmptyProjectEvidenceSource();
      },
    },
    {
      provide: WorksDirectory,
      inject: [DirectoryService],
      useFactory: (directory: DirectoryService): WorksDirectory =>
        new DirectoryWorksDirectory(directory),
    },
    {
      provide: ObjectStoragePresigner,
      inject: [DATA_MODE_TOKEN],
      useFactory: (mode: DataMode): ObjectStoragePresigner => {
        // live 未配置对象存储凭据时 fail closed（503），绝不返回永久地址。
        return mode === 'live'
          ? new UnconfiguredObjectStoragePresigner()
          : new InMemoryObjectStoragePresigner();
      },
    },
  ],
  exports: [WorksService, ProjectEvidenceMaterializer],
})
export class WorksModule {}
