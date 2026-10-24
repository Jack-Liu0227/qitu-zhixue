import { Global, Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATABASE_TOKEN, DATA_MODE_TOKEN, type DataMode } from '../../database';
import { CoursewareStore, InMemoryCoursewareStore } from './courseware.store';
import { PostgresCoursewareStore } from './courseware.store.postgres';

@Global()
@Module({ providers: [{ provide: CoursewareStore, inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
  useFactory: (db: Database | null, mode: DataMode): CoursewareStore => {
    if (db) return new PostgresCoursewareStore(db);
    if (mode === 'live') throw new Error('Courseware storage requires PostgreSQL in live mode');
    return new InMemoryCoursewareStore();
  } }], exports: [CoursewareStore] })
export class CoursewareStorageModule {}
