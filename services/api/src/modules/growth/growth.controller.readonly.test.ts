import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { GrowthController, ParentGrowthController } from './growth.controller';

/**
 * T3 / #5：成长档案只读边界与「AI 不得写档案」的结构性断言。
 *
 * 这里不依赖 Nest 容器：直接读装饰器元数据，证明两个成长控制器上不存在任何
 * 写路由（POST / PUT / PATCH / DELETE）；再用源码扫描证明 AI 搭档模块根本
 * 没有拿到 `GrowthService` 的写入句柄。
 */

const WRITE_VERBS: ReadonlySet<RequestMethod> = new Set([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

interface RouteInfo {
  readonly name: string;
  readonly method: RequestMethod;
  readonly path: unknown;
}

function routeHandlers(controller: new (...args: never[]) => unknown): RouteInfo[] {
  const prototype = controller.prototype as Record<string, unknown>;
  const routes: RouteInfo[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue; // 私有帮助方法，不是路由
    routes.push({ name, method, path: Reflect.getMetadata(PATH_METADATA, handler) });
  }
  return routes;
}

test('成长档案没有客户端写路径：两个控制器都只有 GET 路由', () => {
  for (const controller of [GrowthController, ParentGrowthController]) {
    const routes = routeHandlers(controller);
    assert.ok(routes.length > 0, `${controller.name} 应至少暴露一个读接口`);
    for (const route of routes) {
      assert.equal(
        route.method,
        RequestMethod.GET,
        `${controller.name}.${route.name} 只能是 GET，实际是 ${RequestMethod[route.method]}`,
      );
      assert.equal(WRITE_VERBS.has(route.method), false);
    }
  }
});

test('AI搭档不能写成长档案：ai-tutor 模块不引用 GrowthService / GrowthModule', () => {
  const directory = join(process.cwd(), 'src/modules/ai-tutor');
  const files = readdirSync(directory).filter((file) => file.endsWith('.ts'));
  assert.ok(files.includes('tutor.module.ts'), '应扫描到 AI 搭档模块定义');

  for (const file of files) {
    const source = readFileSync(join(directory, file), 'utf8');
    assert.equal(
      /GrowthService|GrowthModule|growth\.service/.test(source),
      false,
      `${file} 不应引用成长档案的写入服务`,
    );
  }
});
