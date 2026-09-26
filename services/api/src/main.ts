import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  // 默认只监听回环地址：生产入口是 3000 上的 nginx 网关，由它按路径转发到本进程，
  // API 本身不需要对网络暴露（暴露出去等于绕过网关的 TLS / 限流 / 审计入口）。
  // 确需跨主机访问时用 HOST 环境变量显式覆盖，而不是改这里。
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(process.env.PORT ?? 4000, host);
}

void bootstrap();
