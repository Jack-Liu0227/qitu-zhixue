import type { StudentLearningAnalysisStatus } from '@qitu/contracts';
import { analysisStatusMessage } from './analysis-status';

export function AnalysisStatus({ analysis }: { analysis?: StudentLearningAnalysisStatus }) {
  if (!analysis) return null;
  const observed = analysis.observedThrough ? new Date(analysis.observedThrough) : null;
  const date = observed && Number.isFinite(observed.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(observed) : null;
  return <p role="status" className="qitu-profile-muted">
    {analysisStatusMessage(analysis)}
    {date ? ` 覆盖的学习记录截至 ${date}。` : ''}
  </p>;
}
