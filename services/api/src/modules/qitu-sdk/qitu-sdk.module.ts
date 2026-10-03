import { Module } from '@nestjs/common';
import { MasteryModule } from '../mastery/mastery.module';
import { ProjectsModule } from '../projects/projects.module';
import { GrowthModule } from '../growth/growth.module';
import { QituSDKFactory } from './qitu-sdk.service';

@Module({ imports: [MasteryModule, ProjectsModule, GrowthModule], providers: [QituSDKFactory], exports: [QituSDKFactory] })
export class QituSDKModule {}
