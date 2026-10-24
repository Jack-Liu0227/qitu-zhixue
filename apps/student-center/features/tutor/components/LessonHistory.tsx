'use client';

import { useEffect, useState } from 'react';
import type { LearningEvidenceProof, LearningSessionProgressItem, LearningSubmissionArtifactView, LessonEvidenceView } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import type { LessonScope } from '../data/lessonEvidenceApi';

type HistoryState = { kind: 'loading' } | { kind: 'error'; message: string }
  | { kind: 'ready'; evidence: LessonEvidenceView; artifacts: LearningSubmissionArtifactView[] };

const activityLabels = { review: '回顾与观察', theory: '概念与示例', check: '检查与补救', practice: '探究任务', reflect: '表达与反思' };
const proofLabels = { session_response: '学习回应', experiment_observation: '模拟观察回执', submitted_artifact: '课时作品', approved_artifact: '已审核作品' };

export function LessonHistory({ scope, lesson }: { scope: LessonScope; lesson: LearningSessionProgressItem }) {
  const source = useTutorDataSource();
  const [state, setState] = useState<HistoryState>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);
  const { projectId, planId, planRevision, learningSessionId } = scope;
  useEffect(() => {
    let current = true;
    setState({ kind: 'loading' });
    const load = async () => {
      try {
        if (!source.getLessonEvidence || !source.getLearningArtifact) throw new Error('课时记录服务暂不可用。');
        const evidence = await source.getLessonEvidence({ projectId, planId, planRevision, learningSessionId });
        const proofs = [...evidence.submissions, ...evidence.observations, ...evidence.approvedArtifacts, ...evidence.reflections];
        const ids = [...new Set(proofs.flatMap(proof => proof.artifactId ? [proof.artifactId] : []))];
        const readArtifact = source.getLearningArtifact.bind(source);
        const artifacts = await Promise.all(ids.map(id => readArtifact(projectId, id)));
        if (current) setState({ kind: 'ready', evidence, artifacts });
      } catch (cause) {
        if (current) setState({ kind: 'error', message: cause instanceof Error ? cause.message : '课时记录读取失败，请重试。' });
      }
    };
    void load();
    return () => { current = false; };
  }, [source, projectId, planId, planRevision, learningSessionId, revision]);

  return <section aria-label={`第${lesson.lessonIndex}课学习记录`}>
    <h4>第 {lesson.lessonIndex} 课 · {lesson.title}</h4>
    <p>{lesson.completedAt ? `完成时间：${new Date(lesson.completedAt).toLocaleString('zh-CN')}` : '本课尚未完成。'}</p>
    {lesson.activities?.length ? <ol>{lesson.activities.map(activity => <li key={activity.activityId}>
      {activityLabels[activity.kind]} · {activity.status === 'completed' ? '已完成' : activity.status === 'current' ? '进行中' : '待解锁'}
    </li>)}</ol> : null}
    {state.kind === 'loading' ? <p role="status" aria-busy="true">正在读取本课记录…</p> : null}
    {state.kind === 'error' ? <div role="alert"><p>{state.message}</p><button type="button" onClick={() => setRevision(value => value + 1)}>重试读取本课记录</button></div> : null}
    {state.kind === 'ready' ? <SavedRecords evidence={state.evidence} artifacts={state.artifacts} /> : null}
  </section>;
}

function SavedRecords({ evidence, artifacts }: { evidence: LessonEvidenceView; artifacts: LearningSubmissionArtifactView[] }) {
  const proofs = [...evidence.submissions, ...evidence.observations,
    ...evidence.approvedArtifacts.filter(proof => proof.scope.learningSessionId === evidence.scope.learningSessionId), ...evidence.reflections];
  const versions = new Map<string, LearningEvidenceProof>();
  for (const proof of proofs) {
    const key = proof.artifactVersionId ?? proof.ref;
    const previous = versions.get(key);
    versions.set(key, { ...proof, ...(previous?.quality && !proof.quality ? { quality: previous.quality } : {}) });
  }
  const unique = [...versions.values()];
  if (!unique.length) return <p>本课尚无已保存的学习回应、观察或作品。</p>;
  return <ul>{unique.map((proof, index) => <li key={proof.ref}>
    <strong>{proof.sourceKind === 'reflection' ? '学习反思' : proofLabels[proof.kind]} {index + 1}</strong>
    <RecordContent proof={proof} artifact={artifacts.find(artifact => artifact.id === proof.artifactId)} />
    {proof.quality ? <div><p>{({ pending: '等待班主任评价', accepted: '本版本质量已达标', needs_revision: '需要修改', stale: '版本已变化，需重新评价' })[proof.quality.status]}</p>
      {proof.quality.feedback.map(item => <p key={item.criterionId}>{item.feedback}</p>)}
    </div> : null}
    <details><summary>查看保存回执</summary>{proofs.filter(entry => proof.artifactVersionId ? entry.artifactVersionId === proof.artifactVersionId : entry.ref === proof.ref)
      .map(entry => <p key={entry.ref} style={{ overflowWrap: 'anywhere' }}>{entry.ref}</p>)}
      {proof.parameterDigest ? <p style={{ overflowWrap: 'anywhere' }}>模拟参数摘要：{proof.parameterDigest}</p> : null}
    </details>
  </li>)}</ul>;
}

function RecordContent({ proof, artifact }: { proof: LearningEvidenceProof; artifact: LearningSubmissionArtifactView | undefined }) {
  if (!artifact) return null;
  return <div><p>{artifact.title}</p>
    {artifact.latestVersion && artifact.latestVersion.id === proof.artifactVersionId
      ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{artifact.latestVersion.inlineText ?? '该版本没有内联正文。'}</pre>
      : <p>作品当前版本已变化，本课保留原提交版本的回执。</p>}
  </div>;
}
