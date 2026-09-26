import { ApiError } from '@qitu/api-client';

import { INSPIRATION_TEMPLATES } from './fixtures';
import type { InspirationDataSource, InspirationScenario } from './inspiration-data-source';
import type { InspirationTemplate } from '../types';

export interface MockInspirationDataSourceOptions {
  scenario?: InspirationScenario;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function errorFor(scenario: InspirationScenario): ApiError | null {
  if (scenario === 'error') {
    return new ApiError('灵感空间暂时不可用', 500, 'INTERNAL_ERROR');
  }
  if (scenario === 'permission-denied') {
    return new ApiError('当前账号无权访问灵感空间', 403, 'FORBIDDEN');
  }
  if (scenario === 'offline') {
    return new ApiError('网络不可用', 0, 'NETWORK_OFFLINE');
  }
  return null;
}

/**
 * mock 实现：静态 fixture + 场景注入，用于在真 API 落地前驱动五态。
 * 不伪造异步计时器；`error` / `offline` / `permission-denied` 通过抛 `ApiError`
 * 让对应状态真实可达，`empty` 返回空列表。
 */
export function createMockInspirationDataSource(
  options: MockInspirationDataSourceOptions = {},
): InspirationDataSource {
  const scenario = options.scenario ?? 'ready';
  const failure = errorFor(scenario);

  return {
    async listTemplates(): Promise<InspirationTemplate[]> {
      if (failure) throw failure;
      return clone(scenario === 'empty' ? [] : INSPIRATION_TEMPLATES);
    },
  };
}
