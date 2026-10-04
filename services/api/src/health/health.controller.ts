import { Controller, Get, Inject, Logger, Res } from '@nestjs/common';
import type { HealthResponse, ReadinessResponse } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import type { Response } from 'express';
import { REDIS_RUNTIME, type RedisRuntime } from '../common/redis';
import { DATABASE_TOKEN, DATA_MODE_TOKEN, type DataMode } from '../database';
import {
  decideReadiness,
  probeDatabase,
  probeRedis,
  type DependencyProbe,
} from './health.readiness';

const SERVICE_NAME = 'qitu-zhixue-api';
const SERVICE_VERSION = '0.1.0';

/**
 * 健康检查分两个端点，职责不同，不要合并：
 *
 * - `GET /api/v1/health`（存活 / liveness）：不碰任何外部依赖，永远快、
 *   永远 200。**故意保持静态**——它回答的是「进程还活着吗」，不是
 *   「依赖都好吗」。如果这里也去 ping 数据库，数据库抖一下编排层就会
 *   反复重启进程，把一次故障放大成宕机。
 * - `GET /api/v1/health/ready`（就绪 / readiness）：真的 ping Postgres 与
 *   Redis，依赖不可用时返回 503；`degraded` 仍返回 200（详见
 *   `decideReadiness`）。部署脚本与编排层应当探这个端点。
 *
 * 依赖失败的真实原因（可能是含连接串的异常原文）只进服务端日志，
 * 响应里只给「数据库连接失败 / Redis 连接失败」。
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(DATA_MODE_TOKEN) private readonly dataMode: DataMode,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(REDIS_RUNTIME) private readonly redis: RedisRuntime,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    return {
      service: SERVICE_NAME,
      status: 'ok',
      version: SERVICE_VERSION,
    };
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    // 两个探针并行：串行会让就绪检查的时间变成两者之和。
    const [database, redis] = await Promise.all([
      probeDatabase(this.db).catch((error: unknown) => this.failed('数据库', error)),
      probeRedis(this.redis.adapter).catch((error: unknown) => this.failed('Redis', error)),
    ]);

    const decision = decideReadiness({ dataMode: this.dataMode, database, redis });
    response.status(decision.httpStatus);

    if (decision.status !== 'ready') {
      this.logger.warn(
        `就绪状态 ${decision.status}：database=${database.status} redis=${redis.status} dataMode=${this.dataMode}`,
      );
    }

    return {
      service: SERVICE_NAME,
      status: decision.status,
      version: SERVICE_VERSION,
      checkedAt: new Date().toISOString(),
      dataMode: this.dataMode,
      dependencies: { database, redis },
    };
  }

  /** 探针失败：原文进日志，响应里只留一句稳定文案。 */
  private failed(name: string, error: unknown): DependencyProbe {
    this.logger.error(`${name} 就绪探针失败：${error instanceof Error ? error.message : String(error)}`);
    return {
      status: 'error',
      detail: name === '数据库' ? '数据库连接失败' : 'Redis 连接失败',
    };
  }
}
