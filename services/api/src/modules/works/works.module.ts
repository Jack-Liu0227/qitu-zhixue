import { Module } from '@nestjs/common';
import { type Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { TeamRuntimeModule } from '../team-runtime/team-runtime.module';
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
import { PostgresWorksProjectReader, WorksProjectReader } from './works.project-reader';
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
// P2 确定性证据生产者（WS3）：三个生产者 + 两个只读端口 + 评估编排。
import {
  ArtifactBytesReader,
  InMemoryArtifactBytesReader,
  UnconfiguredArtifactBytesReader,
} from './assessor/artifact-bytes.reader';
import { MediaArtifactResolver } from './assessor/media-compliance-validator';
import {
  CodeArtifactResolver,
  LocalPythonSyntaxChecker,
  PythonSyntaxChecker,
} from './assessor/code-static-check-producer';
import { StoreBackedCodeArtifactResolver, StoreBackedMediaArtifactResolver } from './assessor/artifact-resolvers';
import {
  InMemoryProjectAssessmentStore,
  ProjectAssessmentStore,
} from './project-assessment.store';
import { PostgresProjectAssessmentStore } from './project-assessment.store.postgres';
import { ProjectAssessmentService } from './project-assessment.service';
import { WorksLearningEvidenceService } from './works-learning-evidence.service';
import { WorksLearningController } from './works-learning.controller';
import { ArtifactFormatController } from './artifact-format.controller';
import { ArtifactFormatService } from './artifact-format.service';
import { WorksLessonQualityController } from './works-lesson-quality.controller';
import { LearningPlanStorageModule } from '../learning-plan/learning-plan-storage.module';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { TemplatesModule } from '../templates/templates.module';
import { MasteryModule } from '../mastery/mastery.module';
import { CoursewareStorageModule } from '../knowledge/courseware-storage.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { LessonQualityEvaluator, GatewayLessonQualityEvaluator } from './lesson-quality-evaluator';
import { WorksPublicationReview } from './works-publication-review';

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
  // T17：TeamRuntimeModule 提供服务端内部的门禁证据写入（review_completed_and_archived）。
  // 它不反向依赖 WorksModule，因此无循环导入。
  imports: [AuthModule, DirectoryModule, TeamRuntimeModule, LearningPlanStorageModule, TemplatesModule, MasteryModule, CoursewareStorageModule, ModelRegistryModule],
  controllers: [ArtifactsController, FilesController, ProjectEvidenceController, WorksLearningController, WorksLessonQualityController, ArtifactFormatController],
  providers: [
    WorksService,
    WorksPublicationReview,
    { provide: LessonQualityEvaluator, useClass: GatewayLessonQualityEvaluator },
    ArtifactFormatService,
    WorksLearningEvidenceService,
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
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN, LearningPlanStore],
      useFactory: (db: Database | null, mode: DataMode, plans: LearningPlanStore): WorksProjectReader => {
        if (db !== null) return new PostgresWorksProjectReader(db);
        if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：项目只读端口不可用');
        return { findProject: (projectId) => plans.findProject(projectId) };
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

    /* ==================== P2 生产者端口（WS3） ==================== */

    ProjectAssessmentService,
    {
      // 对象存储**读**端口：真实读路径是已声明延后项，live 直接抛稳定错误码
      // （OBJECT_STORAGE_READ_NOT_CONFIGURED）；生产者会把它翻译成
      // 「不可判定」，绝不翻译成「校验不通过」。
      provide: ArtifactBytesReader,
      inject: [DATA_MODE_TOKEN],
      useFactory: (mode: DataMode): ArtifactBytesReader =>
        mode === 'live' ? new UnconfiguredArtifactBytesReader() : new InMemoryArtifactBytesReader(),
    },
    {
      provide: PythonSyntaxChecker,
      useFactory: (): PythonSyntaxChecker => new LocalPythonSyntaxChecker(),
    },
    {
      provide: ProjectAssessmentStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): ProjectAssessmentStore => {
        if (db !== null) return new PostgresProjectAssessmentStore(db);
        if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：评估留痕存储不可用');
        return new InMemoryProjectAssessmentStore();
      },
    },
    {
      // 证据引用 → 真实版本行（含归属学生）。归属校验靠存储行，不靠请求体。
      provide: MediaArtifactResolver,
      inject: [WorksStore],
      useFactory: (store: WorksStore): MediaArtifactResolver => new StoreBackedMediaArtifactResolver(store),
    },
    {
      provide: CodeArtifactResolver,
      inject: [WorksStore],
      useFactory: (store: WorksStore): CodeArtifactResolver => new StoreBackedCodeArtifactResolver(store),
    },
  ],
  exports: [WorksService, WorksStore, ProjectEvidenceMaterializer, ProjectAssessmentService, WorksLearningEvidenceService],
})
export class WorksModule {}
