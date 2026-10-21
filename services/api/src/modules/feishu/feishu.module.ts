import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { FeishuController, FeishuOAuthController } from './feishu.controller';
import { FeishuService } from './feishu.service';
import { ReportingService } from './reporting.service';
import { FeishuReportWorker } from './report-worker.service';
import { FeishuBridgeController } from './feishu-bridge.controller';
import { FeishuBridgeService } from './feishu-bridge.service';
import { FeishuInboxService } from './feishu-inbox.service';
import { FeishuSocketFactory } from './feishu-socket.factory';
import { FeishuAssistantHandlers } from './feishu-assistant-handlers';

@Module({ imports: [AuthModule], controllers: [FeishuController, FeishuOAuthController, FeishuBridgeController], providers: [FeishuService, ReportingService, FeishuReportWorker, FeishuBridgeService, FeishuInboxService, FeishuSocketFactory, FeishuAssistantHandlers], exports: [FeishuService, ReportingService, FeishuReportWorker, FeishuAssistantHandlers] })
export class FeishuModule {}
