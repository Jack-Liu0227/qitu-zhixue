import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { FeishuController, FeishuOAuthController } from './feishu.controller';
import { FeishuService } from './feishu.service';

@Module({ imports: [AuthModule], controllers: [FeishuController, FeishuOAuthController], providers: [FeishuService], exports: [FeishuService] })
export class FeishuModule {}
