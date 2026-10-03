import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { InMemoryLearningPlanStore, LearningPlanStore } from './learning-plan.store';
import { PostgresLearningPlanStore } from './learning-plan.store.postgres';

/** The single storage instance shared by learning-plan, mastery and project owners. */
@Module({
  providers: [{
    provide: LearningPlanStore,
    inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
    useFactory: (db: Database | null, mode: DataMode): LearningPlanStore => {
      if (db !== null) return new PostgresLearningPlanStore(db);
      if (mode === 'live') throw new Error('live 模式缺少 DATABASE_URL：学习计划存储不可用');
      return new InMemoryLearningPlanStore();
    },
  }],
  exports: [LearningPlanStore],
})
export class LearningPlanStorageModule {}
