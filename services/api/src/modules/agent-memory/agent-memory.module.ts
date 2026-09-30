import { Module } from '@nestjs/common';
import { AgentMemoryController } from './agent-memory.controller';
import { AgentMemoryService } from './agent-memory.service';
import { AuthModule } from '../identity-auth/auth.module';

@Module({ imports: [AuthModule], controllers: [AgentMemoryController], providers: [AgentMemoryService], exports: [AgentMemoryService] })
export class AgentMemoryModule {}
