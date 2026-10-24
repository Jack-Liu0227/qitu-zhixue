import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { InspirationCatalogModule } from '../../scripts/inspiration-catalog';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { TemplateGovernanceService } from './templates-governance.service';

test('the Admin catalog command boots the real module graph without a server or external data', { timeout: 30_000 }, async () => {
  const overrides: Record<string, string | undefined> = { NODE_ENV: 'test', QITU_DATA_MODE: 'test', DATABASE_URL: undefined,
    REDIS_URL: undefined, QITU_KNOWLEDGE_WORKER: 'false' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    app = await NestFactory.createApplicationContext(InspirationCatalogModule, { logger: false, abortOnError: false });
    assert(app.get(TemplateGovernanceService) instanceof TemplateGovernanceService);
    assert(app.get(PlatformRegistryService) instanceof PlatformRegistryService);
  } finally {
    await app?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
