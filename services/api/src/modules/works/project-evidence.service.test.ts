import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EmptyProjectEvidenceSource, InMemoryProjectEvidenceStore, type ProjectEvidenceFact } from './project-evidence.store';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import { ProjectEvidenceController } from './project-evidence.controller';

function fact(overrides: Partial<ProjectEvidenceFact> = {}): ProjectEvidenceFact {
  return {
    projectId: 'proj-1',
    studentUserId: 'student-1',
    schoolId: null,
    artifactId: null,
    columnKind: 'independent',
    sourceKind: 'task_submission',
    sourceId: 'sub-1',
    label: '独立完成任务 1',
    detail: '不应外泄的原始细节',
    occurredAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ProjectEvidenceMaterializer（服务端证据物化）', () => {
  it('幂等：同一事实重复物化只有一行', async () => {
    const store = new InMemoryProjectEvidenceStore();
    const materializer = new ProjectEvidenceMaterializer(store, new EmptyProjectEvidenceSource());
    assert.equal(await materializer.ingestServerFacts([fact()]), 1);
    assert.equal(await materializer.ingestServerFacts([fact()]), 0);
    assert.equal((await materializer.read('proj-1')).independent.length, 1);
  });

  it('读投影按三列分组，且不暴露 detail', async () => {
    const store = new InMemoryProjectEvidenceStore();
    const materializer = new ProjectEvidenceMaterializer(store, new EmptyProjectEvidenceSource());
    await materializer.ingestServerFacts([
      fact(),
      fact({ sourceKind: 'tutor_turn', sourceId: 'turn-1', columnKind: 'ai_helped' }),
      fact({ sourceKind: 'escalation_event', sourceId: 'esc-1', columnKind: 'difficulty' }),
    ]);
    const view = await materializer.read('proj-1');
    assert.equal(view.independent.length, 1);
    assert.equal(view.aiHelped.length, 1);
    assert.equal(view.difficulties.length, 1);
    assert.equal(view.aiHelped[0]!.ref, 'tutor_turn:turn-1');
    assert.equal(JSON.stringify(view).includes('不应外泄的原始细节'), false);
  });

  it('作品发布物化：无项目的作品不产生证据', async () => {
    const store = new InMemoryProjectEvidenceStore();
    const materializer = new ProjectEvidenceMaterializer(store, new EmptyProjectEvidenceSource());
    const inserted = await materializer.materializeArtifactPublished({
      id: 'art-1',
      schoolId: null,
      studentId: 'student-1',
      projectId: null,
      templateVersionId: null,
      title: 'A',
      summary: '',
      status: 'published',
      visibility: 'class',
      currentVersionIndex: 1,
      tags: [],
      idempotencyKey: 'k',
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(inserted, 0);
  });
});

describe('项目证据没有客户端写路径', () => {
  it('ProjectEvidenceController 只暴露只读方法', () => {
    const methods = Object.getOwnPropertyNames(ProjectEvidenceController.prototype).filter(
      (name) => name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(ProjectEvidenceController.prototype, name)?.value === 'function',
    );
    assert.deepEqual(methods.sort(), ['get']);
  });
});
