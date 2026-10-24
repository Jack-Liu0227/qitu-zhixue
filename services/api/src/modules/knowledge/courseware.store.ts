import { Injectable } from '@nestjs/common';
import type { CoursewareInstance, CoursewareVersion } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';

export interface CoursewareOperation { hash: string; response: unknown; projectId?: string | null }
@Injectable()
export abstract class CoursewareStore {
  abstract transaction<T>(work: (store: CoursewareStore) => Promise<T>): Promise<T>;
  abstract auditTransaction(): AuditTransaction | undefined;
  abstract versions(status?: string): Promise<CoursewareVersion[]>;
  abstract version(id: string): Promise<CoursewareVersion | null>;
  abstract saveVersion(value: CoursewareVersion): Promise<void>;
  abstract instances(projectId: string, planId: string, revision: number, sessionId: string): Promise<CoursewareInstance[]>;
  abstract instance(id: string): Promise<{ value: CoursewareInstance; hash: string } | null>;
  abstract saveInstance(value: CoursewareInstance, hash: string): Promise<void>;
  abstract operation(id: string): Promise<CoursewareOperation | null>;
  abstract saveOperation(id: string, value: CoursewareOperation): Promise<void>;
}

export class InMemoryCoursewareStore extends CoursewareStore {
  private content = new Map<string, CoursewareVersion>();
  private deliveries = new Map<string, { value: CoursewareInstance; hash: string }>();
  private operations = new Map<string, CoursewareOperation>();
  private queue: Promise<unknown> = Promise.resolve();
  transaction<T>(work: (store: CoursewareStore) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const snapshot = structuredClone([this.content, this.deliveries, this.operations] as const);
      try { return await work(this); }
      catch (error) { [this.content, this.deliveries, this.operations] = snapshot; throw error; }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  auditTransaction() { return undefined; }
  async versions(status?: string) { return structuredClone([...this.content.values()].filter(v => !status || v.status === status).slice(-200).reverse()); }
  async version(id: string) { return structuredClone(this.content.get(id) ?? null); }
  async saveVersion(value: CoursewareVersion) { this.content.set(value.versionId, structuredClone(value)); }
  async instances(projectId: string, planId: string, revision: number, sessionId: string) {
    return structuredClone([...this.deliveries.values()].map(item => item.value).filter(v => v.projectId === projectId
      && v.planId === planId && v.planRevision === revision && v.learningSessionId === sessionId));
  }
  async instance(id: string) { return structuredClone(this.deliveries.get(id) ?? null); }
  async saveInstance(value: CoursewareInstance, hash: string) { this.deliveries.set(value.id, structuredClone({ value, hash })); }
  async operation(id: string) { return structuredClone(this.operations.get(id) ?? null); }
  async saveOperation(id: string, value: CoursewareOperation) { this.operations.set(id, structuredClone(value)); }
}
