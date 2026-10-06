import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database';
import { AuditModule } from '../../common/audit/audit.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { AuthModule } from '../identity-auth/auth.module';
import { TeamRuntimeController } from './team-runtime.controller';
import { TeamRuntimeService } from './team-runtime.service';

@Module({
  imports: [AuthModule, DatabaseModule, AuditModule, OutboxModule],
  controllers: [TeamRuntimeController],
  providers: [TeamRuntimeService],
  exports: [TeamRuntimeService],
})
export class TeamRuntimeModule {}
