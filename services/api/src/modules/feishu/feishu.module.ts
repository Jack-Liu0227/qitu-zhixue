import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { FeishuController, FeishuOAuthController } from './feishu.controller';
import { FeishuService } from './feishu.service';
import { ReportingService } from './reporting.service';
import { FeishuReportWorker } from './report-worker.service';

@Module({ imports: [AuthModule], controllers: [FeishuController, FeishuOAuthController], providers: [FeishuService, ReportingService, FeishuReportWorker], exports: [FeishuService, ReportingService, FeishuReportWorker] })
export class FeishuModule {}
