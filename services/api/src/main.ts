import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  // 所有未捕获异常统一成 RFC 9457 Problem Details（见 common/http/problem-details.ts）。
  // 必须在这里注册：Nest 默认过滤器会按「抛的人怎么写」透传响应体，
  // 导致同一个 API 出现 `{code,message}` 与 `{statusCode,message,error}` 两种形态。
  app.useGlobalFilters(new ProblemDetailsFilter());

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000, process.env.HOST ?? '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  // 启动失败必须留下可读日志并以非 0 退出，否则编排层会以为进程正常起来了。
  new Logger('Bootstrap').error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
