import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ReportingService } from './reporting.service';

test('ReportingService rejects non-admin actors before touching report storage', async () => {
  let touched = false;
  const service = new ReportingService(
    { select: () => { touched = true; throw new Error('must not query'); } } as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    () => service.buildReport({ id: 'teacher-1', role: 'teacher' } as never),
    ForbiddenException,
  );
  assert.equal(touched, false);
});

test('ReportingService fails closed when database is unavailable', async () => {
  const service = new ReportingService(null, {} as never, {} as never);
  await assert.rejects(
    () => service.buildReport({ id: 'admin-1', role: 'admin' } as never),
    ServiceUnavailableException,
  );
});

