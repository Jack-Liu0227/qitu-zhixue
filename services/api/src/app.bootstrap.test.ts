import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProjectAssessmentService } from './modules/works/project-assessment.service';
import { ArtifactBytesReader } from './modules/works/assessor/artifact-bytes.reader';

test(
  'the real application dependency graph boots and serves health',
  { timeout: 30_000 },
  async () => {
    const overrides: Record<string, string | undefined> = {
      NODE_ENV: 'test',
      QITU_DATA_MODE: 'test',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    };
    const previous = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    );
    let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
    try {
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      // Unlike service unit tests, Nest must resolve every real provider token here.
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      app.setGlobalPrefix('api/v1');
      assert.ok(app.get(ProjectAssessmentService) instanceof ProjectAssessmentService);
      assert.ok(app.get(ArtifactBytesReader) instanceof ArtifactBytesReader);
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/api/v1/health`);
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { status: string }).status, 'ok');
    } finally {
      await app?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
