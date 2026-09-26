import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  // 统一对外暴露：绑定 0.0.0.0，允许 IP + 端口直接访问；仍可用 HOST 环境变量覆盖。
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(process.env.PORT ?? 4000, host);
}

void bootstrap();
