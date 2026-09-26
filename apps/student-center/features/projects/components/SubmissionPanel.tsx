'use client';

import { useState } from 'react';
import { SectionCard } from '@qitu/ui';
import { useTaskSubmission } from '../hooks/useProjectsMutations';
import { ArtifactUploader } from './ArtifactUploader';

export interface SubmissionPanelProps {
  taskId: string;
  stageId: string;
  /** 阶段锁定或断网时禁用；不可在客户端绕过。 */
  disabled?: boolean;
}

/**
 * 任务提交面板。写操作带 `Idempotency-Key`（验收 11），
 * 双击由 hook 内部的 pending 与复用键保证只落一条。
 */
export function SubmissionPanel({ taskId, disabled = false }: SubmissionPanelProps) {
  const { mutate, pending, error, result } = useTaskSubmission(taskId);
  const [content, setContent] = useState('');
  const [artifactRefs, setArtifactRefs] = useState<string[]>([]);

  const handleSubmit = async (): Promise<void> => {
    await mutate({ content, artifactRefs });
  };

  return (
    <SectionCard title="提交本次成果">
      <ArtifactUploader
        disabled={disabled || pending}
        onUploaded={(objectKey) => setArtifactRefs((refs) => [...refs, objectKey])}
      />
      {artifactRefs.length > 0 ? (
        <p className="qitu-form-hint">已附加 {artifactRefs.length} 个文件</p>
      ) : null}
      <label>
        <span>说明你的做法与发现</span>
        <textarea
          value={content}
          disabled={disabled || pending}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      {error ? <p className="qitu-form-error">提交失败：{error.message}</p> : null}
      {result ? <p className="qitu-form-success">已提交（编号 {result.submissionId}）。</p> : null}
      <button
        type="button"
        className="qitu-button qitu-button-primary"
        disabled={disabled || pending || content.trim().length === 0}
        onClick={handleSubmit}
      >
        {pending ? '提交中…' : '提交'}
      </button>
    </SectionCard>
  );
}
