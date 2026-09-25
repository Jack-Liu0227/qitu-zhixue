import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@qitu/contracts';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: 'qitu-zhixue-api',
      status: 'ok',
      version: '0.1.0',
    };
  }
}
