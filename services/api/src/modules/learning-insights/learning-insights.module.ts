import { Module } from '@nestjs/common';
import { LearningInsightsService } from './learning-insights.service';

@Module({ providers: [LearningInsightsService], exports: [LearningInsightsService] })
export class LearningInsightsModule {}
