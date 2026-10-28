'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningEvidenceProof, LearningSessionProgressItem, LearningSubmissionArtifactView, LessonEvidenceView } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { createIdempotencyKey } from '../idempotency';
import type { LessonScope, LessonSubmissionKind } from '../data/lessonEvidenceApi';
import { lessonBlockerLabel } from './lessonBlockers';
import { ArtifactExportButtons } from './ArtifactExportButtons';

interface Props {
  scope: LessonScope;
  lesson: LearningSessionProgressItem;
  refreshKey?: unknown;
  disabled?: boolean;
  onSaved: (key: string, reconcile: boolean) => Promise<void>;
  onComplete: (refs: string[], key: string) => Promise<void>;
}

const labels: Record<LearningEvidenceProof['kind'], string> = {
  session_response: '课时表达', experiment_observation: '实验观察',
  submitted_artifact: '课时作品', approved_artifact: '已审核并发布的作品',
};

export function LessonWorkPanel({ scope, lesson, refreshKey, disabled, onSaved, onComplete }: Props) {
  const source = useTutorDataSource();
  const [evidence, setEvidence] = useState<LessonEvidenceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<LessonSubmissionKind>('responses');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [objectiveId, setObjectiveId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<LearningSubmissionArtifactView | null>(null);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const keys = useRef(new Map<string, string>());
  const { projectId, planId, planRevision, learningSessionId } = scope;
  const activity = lesson.activities?.find(entry => entry.status === 'current');
  const stableScope = { projectId, planId, planRevision, learningSessionId };
  useEffect(() => {
    setContent(''); setTitle(''); setPreview(null); setNotice(null);
    previewGeneration.current += 1;
  }, [activity?.activityId]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current += 1; previewGeneration.current += 1; };
  }, []);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      if (!source.getLessonEvidence) throw new Error('本课时的证据服务尚未接通。');
      const result = await source.getLessonEvidence({ projectId, planId, planRevision, learningSessionId });
      if (!alive.current || request !== generation.current) return;
      setEvidence(result);
      setKind((old) => activity?.evidence === 'submitted_artifact' ? 'artifacts'
        : activity?.kind === 'reflect' && result.allowedActions.includes('reflect') && result.approvedArtifacts.length > 0 ? 'reflections'
          : activity?.evidence === 'session_response' ? 'responses'
          : old === 'reflections' && !result.allowedActions.includes('reflect') ? 'responses' : old);
      setObjectiveId((old) => result.scope.objectiveIds.includes(old) ? old : result.scope.objectiveIds[0] ?? '');
      const known = new Set([...result.submissions, ...result.observations, ...result.approvedArtifacts, ...result.reflections].map((proof) => proof.ref));
      setSelected((old) => old.filter((ref) => known.has(ref)));
      setLoading(false);
    } catch (cause) {
      if (!alive.current || request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : '学习证据读取失败');
      setLoading(false);
      setEvidence(null);
    }
  }, [source, projectId, planId, planRevision, learningSessionId, activity?.kind, activity?.evidence]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const run = async (fingerprint: string, operation: (key: string) => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const key = keys.current.get(fingerprint) ?? createIdempotencyKey();
    keys.current.set(fingerprint, key);
    try {
      await operation(key);
      keys.current.delete(fingerprint);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '操作未完成，请重试。');
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  };
  const submit = () => {
    const body = { planRevision, content: content.trim(), evidenceRefs: selected,
      ...(activity ? { activityId: activity.activityId } : {}),
      ...(kind === 'artifacts' ? { title: title.trim(), objectiveId, requestReview: true } : {}) };
    void run(JSON.stringify([kind, body]), async (key) => {
      if (!source.submitLessonEvidence) throw new Error('学习内容提交服务暂不可用。');
      const receipt = await source.submitLessonEvidence(stableScope, kind, body, key);
      if (!alive.current) return;
      previewGeneration.current += 1;
      setPreview(receipt.artifact);
      setSelected((old) => [...new Set([...old, receipt.proof.ref])]);
      setContent('');
      setNotice(receipt.evaluationError ?? (receipt.proof.quality?.status === 'needs_revision' ? '记录已保存，请根据自动评价补充后重新提交。' : '记录已保存并完成自动评价，可继续查看当前活动。'));
      await reload();
      if (alive.current) await onSaved(key, kind !== 'responses');
    });
  };
  const proofs = evidence ? [...evidence.submissions, ...evidence.observations, ...evidence.approvedArtifacts, ...evidence.reflections] : [];
  const previewProof = preview ? proofs.find(proof => proof.artifactId === preview.id
    && proof.artifactVersionId === preview.latestVersion?.id) : undefined;
  const previewIsArtifact = previewProof?.kind === 'submitted_artifact' || previewProof?.kind === 'approved_artifact';
  const blocked = disabled || pending || loading || evidence === null;
  const canReflect = evidence?.allowedActions.includes('reflect') === true && evidence.approvedArtifacts.length > 0;
  const actionAllowed = evidence?.allowedActions.includes(kind === 'artifacts' ? 'submit_artifact' : kind === 'reflections' ? 'reflect' : 'respond') === true;
  return (
    <div className="qitu-tutor-lesson-work">
      <h4>第 {lesson.lessonIndex} 课 · {lesson.title}</h4>
      {activity ? <div role="note"><strong>当前活动</strong><p>{activity.guidance}</p>
        {activity.evidence === 'mastery' ? <p>请在正式目标考核中作答；聊天求助不会替你提交。</p>
          : activity.evidence === 'experiment_observation' ? <p>请在本课注册实验中保存观察记录。</p> : null}</div> : null}
      {lesson.blockers.length ? <ul>{lesson.blockers.map((reason) => <li key={reason}>{lessonBlockerLabel(reason)}</li>)}</ul> : null}
      {activity?.evidence === 'teaching_delivery' ? <p>先跟随 AI搭档阅读本课课件；看完后可继续，也可以再听一次解释或看一个例子。</p> : null}
      {loading ? <p role="status">正在读取已保存的证据…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <button type="button" disabled={pending || disabled} onClick={() => { setError(null); void reload(); }}>刷新学习记录</button>
      {evidence && activity?.evidence !== 'teaching_delivery' ? <>
        {evidence.qualityCriteria?.length ? <div role="note">
          <strong>本课产物由系统按质量标准自动评价</strong>
          <ul>{evidence.qualityCriteria.map(criterion => <li key={criterion.id}>{criterion.description}</li>)}</ul>
          <p>保存后自动评价，无需等待老师。未达标时依据反馈补充；评价服务故障时可重试，已保存内容不会丢失。</p>
        </div> : null}
        <label>记录类型
          <select value={kind} disabled={blocked} onChange={(event) => setKind(event.target.value as LessonSubmissionKind)}>
            <option value="responses" disabled={!evidence.allowedActions.includes('respond')}>本课时回答与探究表达</option>
            <option value="artifacts" disabled={!evidence.allowedActions.includes('submit_artifact')}>作品报告并自动评价</option>
            {canReflect ? <option value="reflections">作品完成后的反思</option> : null}
          </select>
        </label>
        {kind === 'artifacts' ? <>
          <label>作品标题<input value={title} maxLength={120} disabled={blocked} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>对应目标<select value={objectiveId} disabled={blocked} onChange={(event) => setObjectiveId(event.target.value)}>
            {evidence.scope.objectiveIds.map((id, index) => <option key={id} value={id}>本课目标 {index + 1}</option>)}
          </select></label>
        </> : null}
        <label>{kind === 'artifacts' ? '作品正文' : kind === 'reflections' ? '反思正文' : '我的回答、观察与理由'}
          <textarea rows={5} value={content} maxLength={kind === 'reflections' ? 4000 : 10000}
            disabled={blocked} onChange={(event) => setContent(event.target.value)} />
        </label>
        <p>请使用自己的表达。保存记录不会自动判定掌握，也不会自动完成课时。</p>
        {evidence.allowedActions.includes('reflect') && !canReflect ? <p>最终反思需要先发布已通过自动评价的作品。</p> : null}
        {proofs.length ? <fieldset disabled={blocked}><legend>选择用于本课时的已保存证据</legend>
          {proofs.map((proof, index) => <div key={proof.ref}>
            {proof.quality ? <div role="status">
              {({ pending: '已保存，自动评价未完成', accepted: '本版本质量已达标', needs_revision: '需要修改后重新提交', stale: '产物版本已变化，请重新提交' })[proof.quality.status]}
              {proof.quality.feedback.filter(item => !item.meets).map(item => <p key={item.criterionId}>{item.feedback}</p>)}
            </div> : null}
            {proof.quality?.status === 'pending' && source.evaluateLessonEvidence ? <button type="button" onClick={() => {
              void run(JSON.stringify(['evaluate', proof.ref]), async key => {
                await source.evaluateLessonEvidence!(stableScope, proof.ref, key);
                await reload();
                if (alive.current) await onSaved(key, false);
              });
            }}>重试自动评价</button> : null}
            <label><input type="checkbox" checked={selected.includes(proof.ref)} onChange={(event) => setSelected((old) =>
              event.target.checked ? [...old, proof.ref] : old.filter((ref) => ref !== proof.ref))} />
              {proof.sourceKind === 'reflection' ? '学习反思' : labels[proof.kind]} {index + 1}
            </label>
            {proof.artifactId ? <button type="button" disabled={!source.getLearningArtifact} onClick={() => {
              const request = ++previewGeneration.current;
              void source.getLearningArtifact?.(projectId, proof.artifactId!).then((result) => {
                if (alive.current && request === previewGeneration.current) { setPreview(result); setError(null); }
              }).catch((cause) => {
                if (alive.current && request === previewGeneration.current) setError(cause instanceof Error ? cause.message : '内容读取失败');
              });
            }}>查看内容与审核状态</button> : null}
          </div>)}
        </fieldset> : <p>暂无已保存证据。可先提交本课表达，或在对话实验中保存观察。</p>}
        <button type="button" disabled={blocked || !actionAllowed || !content.trim()
          || (!!lesson.activities && (!activity || activity.evidence !== (kind === 'artifacts' ? 'submitted_artifact' : 'session_response')))
          || (kind === 'artifacts' && (!title.trim() || !objectiveId))}
          onClick={submit}>{pending ? '正在提交…' : '保存学习记录'}</button>
        <button type="button" disabled={blocked || !lesson.canComplete || selected.length === 0}
          onClick={() => { void run(JSON.stringify(['complete', selected]), async (key) => {
            await onComplete(selected, key);
            if (alive.current) setNotice('服务端已确认课时完成。');
          }); }}>提交证据并申请完成本课</button>
      </> : null}
      {preview ? <details open>
        <summary>{preview.title}</summary>
        {previewIsArtifact ? <>
          <p>作品状态：{({ draft: '未提交', submitted: '已送审', in_review: '审核中', published: '已发布', changes_requested: '需要修改', archived: '已归档' })[preview.status]}</p>
          <p>作品评价：{({ requested: '已申请', in_review: '审核中', approved: '已通过', changes_requested: '需要修改', rejected: '未通过', none: '尚未申请' })[preview.reviewStatus]}</p>
        </> : <p>学习记录已保存。{previewProof?.quality
          ? ({ pending: '自动评价尚未完成，请在上方重试。', accepted: '本版本质量已达标。', needs_revision: '请根据上方反馈修改。', stale: '版本已变化，请重新评价。' })[previewProof.quality.status]
          : '评价结果以本课记录中的回执为准。'}</p>}
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.latestVersion?.inlineText ?? '该版本暂无内联正文。'}</pre>
        {preview.latestVersion?.inlineText ? <ArtifactExportButtons artifactId={preview.id} versionId={preview.latestVersion.id} title={preview.title} /> : null}
        {previewIsArtifact && preview.reviewStatus === 'approved' && preview.status !== 'published' ? <button type="button" disabled={blocked}
          onClick={() => { void run(JSON.stringify(['publish', preview.id, preview.latestVersion?.id]), async (key) => {
            if (!source.publishLearningArtifact) throw new Error('作品发布服务暂不可用。');
            const result = await source.publishLearningArtifact(projectId, preview.id, key);
            if (!alive.current) return;
            previewGeneration.current += 1;
            setPreview(result);
            setNotice(result.status === 'published' ? '作品已由服务端确认发布。' : '发布申请已提交，请刷新核对状态。');
            await reload();
            if (alive.current) await onSaved(key, true);
          }); }}>发布已评价的作品</button> : null}
      </details> : null}
    </div>
  );
}
