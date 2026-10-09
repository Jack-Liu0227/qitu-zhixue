import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
import {
  InMemoryPublicContentStore,
  consultationInput,
  PublicContentStoreConflictError,
} from './public-content.store';
import { PublicContentService } from './public-content.service';
import { DEMO_FEATURED_TEMPLATES } from './public-content.demo-seed';

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];

  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

function makeHarness(templates = DEMO_FEATURED_TEMPLATES) {
  const store = new InMemoryPublicContentStore({ templates });
  const audit = new FakeAuditWriter();
  const service = new PublicContentService(store, audit as unknown as AuditWriter);
  return { store, audit, service };
}

describe('PublicContentService.getHomeView', () => {
  it('只出平台模板与聚合计数，且不把 store 记录暴露成可变引用', async () => {
    const { service } = makeHarness();

    const view = await service.getHomeView();

    assert.equal(view.stats.publishedTemplates, DEMO_FEATURED_TEMPLATES.length);
    assert.equal(view.templates.length, DEMO_FEATURED_TEMPLATES.length);
    assert.equal(typeof view.generatedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(view.generatedAt)));

    // 投影必须是副本：调用方改结果不能污染 store。
    const first = view.templates[0];
    assert.ok(first !== undefined);
    first.learningObjectives.push('注入的假目标');
    first.stages.push({ id: 'fake', label: '假阶段' });

    const again = await service.getHomeView();
    assert.equal(again.templates[0]?.learningObjectives.includes('注入的假目标'), false);
    assert.equal(again.templates[0]?.stages.some((stage) => stage.id === 'fake'), false);
  });

  it('limit 生效并有硬上限，非法值回落默认值', async () => {
    const { service } = makeHarness();

    const single = await service.getHomeView(1);
    assert.equal(single.templates.length, 1);

    const clamped = await service.getHomeView(999);
    assert.equal(clamped.templates.length, DEMO_FEATURED_TEMPLATES.length);

    const fallback = await service.getHomeView(Number.NaN);
    assert.equal(fallback.templates.length, DEMO_FEATURED_TEMPLATES.length);
  });

  it('空库返回 0 与空数组，不抛错（0 是有效事实）', async () => {
    const { service } = makeHarness([]);

    const view = await service.getHomeView();

    assert.deepEqual(view.templates, []);
    assert.equal(view.stats.learners, 0);
    assert.equal(view.stats.publishedTemplates, 0);
  });

  it('publishedAt 投影为 ISO 字符串，null 保持 null', async () => {
    const { service } = makeHarness([
      { ...DEMO_FEATURED_TEMPLATES[0]!, id: 't-null', slug: 't-null', publishedAt: null },
    ]);

    const view = await service.getHomeView();

    assert.equal(view.templates[0]?.publishedAt, null);
  });
});

describe('PublicContentService.submitConsultation', () => {
  it('落库并回执 received；审计不含姓名与电话', async () => {
    const { service, store, audit } = makeHarness([]);

    const receipt = await service.submitConsultation(
      { name: '林老师', phone: '13800001111', identity: 'school', message: '想给初二开一门课' },
      'key-1',
    );

    assert.equal(receipt.status, 'received');
    assert.equal(store.consultationCount, 1);

    const entry = audit.entries[0];
    assert.ok(entry !== undefined);
    assert.equal(entry.action, 'public.consultation.submit');
    assert.equal(entry.targetType, 'consultation_request');
    assert.equal(entry.targetId, receipt.id);
    assert.equal(entry.actorId, null);

    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes('13800001111'), false);
    assert.equal(serialized.includes('林老师'), false);
    assert.equal(serialized.includes('想给初二开一门课'), false);

    // 落库的线索本身保留联系方式（回访必需），这里断言的是审计面。
    const stored = await store.findConsultationByIdempotencyKey('key-1');
    assert.equal(stored?.phone, '13800001111');
    assert.equal(stored?.identity, 'school');
    assert.equal(stored?.source, 'public-home');
  });

  it('同幂等键重复提交只落一行，且返回同一 id', async () => {
    const { service, store } = makeHarness([]);
    const input = { name: '张同学', phone: '13900002222', identity: 'student' as const };

    const first = await service.submitConsultation(input, 'key-2');
    const second = await service.submitConsultation(input, 'key-2');

    assert.equal(second.id, first.id);
    assert.equal(store.consultationCount, 1);
  });

  it('同幂等键不同载荷抛冲突，不静默覆盖', async () => {
    const { service, store } = makeHarness([]);

    await store.createConsultation(
      consultationInput('parent', { idempotencyKey: 'key-3', phone: '13700003333' }),
    );

    await assert.rejects(
      () =>
        store.createConsultation(
          consultationInput('parent', { idempotencyKey: 'key-3', phone: '13700004444' }),
        ),
      PublicContentStoreConflictError,
    );
    assert.equal(store.consultationCount, 1);
    // 服务层不应吞掉该冲突（由调用方决定映射成 409）。
    await assert.rejects(
      () =>
        service.submitConsultation(
          { name: '张同学', phone: '13700004444', identity: 'parent' },
          'key-3',
        ),
      PublicContentStoreConflictError,
    );
  });
});
