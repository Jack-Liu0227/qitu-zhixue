import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { withTransaction } from '@qitu/database';
import { AuditService } from '../../common/audit';
import { AuthService } from '../identity-auth/auth.service';
import { DirectoryService } from '../directory/directory.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { ModelConfigController } from './model-config.controller';

test('runtime projection requires authentication and exposes no legacy model write endpoint', () => {
  const registry = new ModelRegistryService(null, new AuditService(null));
  const controller = new ModelConfigController(registry, new AuthService(new DirectoryService('test', null, withTransaction)));
  assert.throws(() => controller.getRuntime(undefined), UnauthorizedException);
  assert.throws(() => controller.getRuntime('qitu_session=invalid'), UnauthorizedException);
  assert.deepEqual(Object.getOwnPropertyNames(ModelConfigController.prototype), ['constructor', 'getRuntime']);
  assert.equal(Reflect.getMetadata('path', ModelConfigController.prototype.getRuntime), 'models/runtime');
});
