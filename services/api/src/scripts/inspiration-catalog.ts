import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TemplatesModule } from '../modules/templates/templates.module';
import { eq } from 'drizzle-orm';
import { users, type Database } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import { DatabaseModule, DATABASE_TOKEN } from '../database';
import { AuditModule } from '../common/audit/audit.module';
import { AccessModule } from '../common/access/access.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { PlatformRegistryModule } from '../modules/platform-registry/platform-registry.module';
import { PlatformRegistryService } from '../modules/platform-registry/platform-registry.service';
import { ModelRegistryService } from '../modules/model-registry/model-registry.service';
import { TemplateStore } from '../modules/templates/templates.store';
import { TemplateBindingStore } from '../modules/templates/templates-binding.store';
import { TemplateBindingService } from '../modules/templates/templates-binding.service';
import { TemplateGovernanceService } from '../modules/templates/templates-governance.service';
import { configureInspirationCatalog } from '../modules/templates/inspiration-catalog-bootstrap';
import { INSPIRATION_COURSES } from '../modules/templates/content/inspiration';
import { INSPIRATION_DIALOGUE_COURSES } from '../modules/templates/content/inspiration/dialogue-courses';

@Module({ imports: [DatabaseModule, AuditModule, AccessModule, IdempotencyModule, TemplatesModule, PlatformRegistryModule] })
export class InspirationCatalogModule {}

function option(name: string) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; }
async function main() {
  const adminId = option('--admin-user-id');
  if (!adminId) throw new Error('Explicit --admin-user-id is required');
  const mode = option('--mode') ?? 'draft';
  if (!['draft', 'pilot'].includes(mode)) throw new Error('Mode must be draft or pilot');
  const progression = option('--progression') ?? 'guided';
  if (progression !== 'guided' && progression !== 'dialogue') throw new Error('Progression must be guided or dialogue');
  const catalog = progression === 'dialogue' ? INSPIRATION_DIALOGUE_COURSES : INSPIRATION_COURSES;
  const app = await NestFactory.createApplicationContext(InspirationCatalogModule, { logger: ['error', 'warn'] });
  try {
    const db = app.get<Database>(DATABASE_TOKEN);
    const [admin] = await db.select({ id: users.id, role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, adminId));
    if (!admin || admin.role !== 'admin' || admin.disabledAt) throw new Error('ADMIN_IDENTITY_UNAVAILABLE');
    const actor: CurrentUser = { id: admin.id, role: 'admin', email: '', displayName: '' };
    const provider = option('--model-provider-id'), modelId = option('--model-id');
    if (!!provider !== !!modelId) throw new Error('Both model provider ID and model ID are required together');
    const configured = app.get(ModelRegistryService).resolve('tutor.chat');
    const selection = provider && modelId ? { modelProviderId: provider, modelId }
      : configured ? { modelProviderId: configured.providerId, modelId: configured.modelId } : null;
    if (!selection) throw new Error('ADMIN_MODEL_PAIR_UNAVAILABLE');
    const templates = app.get(TemplateStore), bindingStore = app.get(TemplateBindingStore), registry = app.get(PlatformRegistryService);
    const before = await templates.listTemplates({ visibleToSchoolId: null });
    if (process.argv.includes('--inspect')) {
      return { readOnly: true, modelPair: selection, modelAvailable: registry.isModelAvailable(selection),
        existingTemplates: before.map(item => ({ id: item.id, slug: item.slug, status: item.status })),
        plannedProjects: catalog.map(course => ({ slug: course.slug, title: course.spec.title, teamId: course.teamId, lessons: 8 })) };
    }
    const preserved = new Map<string, string>();
    for (const template of before.filter(item => !catalog.some(course => course.slug === item.slug))) {
      for (const version of await templates.listVersions(template.id)) {
        const binding = await bindingStore.findActiveBinding(version.id);
        preserved.set(version.id, JSON.stringify({ status: version.status, content: version.content, binding }));
      }
    }
    const report = await configureInspirationCatalog({ registry, templates, bindingStore,
      governance: app.get(TemplateGovernanceService), bindings: app.get(TemplateBindingService) },
    { actor, model: selection, mode: mode === 'pilot' ? 'pilot' : 'draft', projects: option('--projects')?.split(','), progression });
    for (const [id, expected] of preserved) {
      const version = await templates.findVersion(id), binding = await bindingStore.findActiveBinding(id);
      if (JSON.stringify({ status: version?.status, content: version?.content, binding }) !== expected) throw new Error('HISTORICAL_TEMPLATE_OR_BINDING_CHANGED');
    }
    if (!report.success) process.exitCode = 1;
    return { ...report, preservedHistoricalVersions: preserved.size,
      visibleTemplates: (await templates.listTemplates({ visibleToSchoolId: null })).filter(item => ['published', 'piloting'].includes(item.status))
        .map(item => ({ id: item.id, slug: item.slug, title: item.title, status: item.status })) };
  } finally { await app.close(); }
}
if (require.main === module) void main().then(report => console.log(JSON.stringify(report)))
  .catch(error => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INSPIRATION_CATALOG_FAILED'); process.exitCode = 1; });
