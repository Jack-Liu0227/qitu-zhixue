import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { METHOD_METADATA, PATH_METADATA, RequestMethod } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';

test('admin teacher list is registered as GET /admin/teachers', () => {
  assert.equal(Reflect.getMetadata(PATH_METADATA, AdminController), 'admin');
  assert.equal(Reflect.getMetadata(PATH_METADATA, AdminController.prototype.getTeachers), 'teachers');
  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, AdminController.prototype.getTeachers),
    RequestMethod.GET,
  );
});
