import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { AuthService } from '../identity-auth/auth.service';
import type { DirectoryService } from '../directory/directory.service';
import type { GrowthService } from '../growth/growth.service';
import type { PlatformDataService } from '../platform-data/platform-data.service';
import type { FeedbackService } from '../feedback/feedback.service';
import type { ParentGrowthExportService } from './growth-export.service';
import { ParentController } from './parent.controller';

test('invalid encouragement content and oversized request keys are rejected before a write', async () => {
  const auth = { getSession: () => ({ user: { id: 'parent', role: 'parent' } }) } as unknown as AuthService;
  const growth = { canParentReadChild: async () => true } as unknown as GrowthService;
  const controller = new ParentController(auth, {} as DirectoryService, growth, {} as PlatformDataService, {} as FeedbackService, {} as ParentGrowthExportService);
  await assert.rejects(controller.sendEncouragement('qitu_session=fixture', 'key', 'child', { message: 7 }), BadRequestException);
  await assert.rejects(controller.sendEncouragement('qitu_session=fixture', 'k'.repeat(161), 'child', { message: '一起看看你的发现。' }), BadRequestException);
});
