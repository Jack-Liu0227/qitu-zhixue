import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { VisualAssetsController } from './visual-assets.controller';
import { VisualAssetsService } from './visual-assets.service';

@Global()
@Module({ imports: [AuthModule], controllers: [VisualAssetsController], providers: [VisualAssetsService], exports: [VisualAssetsService] })
export class VisualAssetsModule {}
