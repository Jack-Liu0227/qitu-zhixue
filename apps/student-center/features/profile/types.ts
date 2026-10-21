import type { StudentGrowthEntry, StudentGrowthSummary } from '../growth/types';
import type { StudentLearningAnalysisStatus, StudentGrowthTrajectoryProjection } from '@qitu/contracts';

export interface StudentProfileProjection {
  studentId: string;
  version: number;
  updatedAt: string | null;
  priorKnowledge: string | null;
  targetLevel: string | null;
  timeBudgetMinutesPerWeek: number | null;
  preferences: string[];
  interests: string[];
  strengths: string[];
  nextQuestions: string[];
  recentGrowth: StudentGrowthEntry[];
  summary: StudentGrowthSummary;
  freshness: 'fresh' | 'unavailable';
  provenance: {
    profileAssistantId: string | null;
    growthAssistantId: string | null;
  };
  analysis?: StudentLearningAnalysisStatus;
  growthAnalysis?: StudentLearningAnalysisStatus;
  trajectory: StudentGrowthTrajectoryProjection | null;
}
