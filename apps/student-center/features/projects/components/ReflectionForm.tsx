'use client';

import { useEffect, useState } from 'react';
import { OfflineBanner, SectionCard } from '@qitu/ui';
import { useReflectionSubmit } from '../hooks/useProjectsMutations';
import type { ReflectionInput } from '../types';

export interface ReflectionFormProps {
  projectId: string;
  stageId: string;
  /** 断网：本机暂存反思正文（不含任何对话转写/语音），恢复后可提交。 */
  offline?: boolean;
}

const DRAFT_PREFIX = 'qitu:reflection-draft:';

/** 反思表单；提交带幂等键，作品/反思必须关联具体阶段。 */
export function ReflectionForm({ projectId, stageId, offline = false }: ReflectionFormProps) {
  const { mutate, pending, error, result } = useReflectionSubmit(projectId);
  const draftKey = `${DRAFT_PREFIX}${projectId}:${stageId}`;
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<ReflectionInput['visibility']>('private');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setText(saved);
    } catch {
      // 无痕模式等场景下忽略
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (text) {
        window.localStorage.setItem(draftKey, text);
      } else {
        window.localStorage.removeItem(draftKey);
      }
    } catch {
      // 忽略存储失败
    }
  }, [draftKey, text]);

  const handleSubmit = async (): Promise<void> => {
    const response = await mutate({ stageId, text, visibility });
    if (response) {
      setText('');
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // 忽略
      }
    }
  };

  return (
    <SectionCard title="我的反思">
      {offline ? <OfflineBanner readOnly bufferedCount={text ? 1 : 0} /> : null}
      <label>
        <span>这次项目你学到了什么？</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <label>
        <span>可见范围</span>
        <select
          value={visibility}
          onChange={(event) =>
            setVisibility(event.target.value === 'mentor' ? 'mentor' : 'private')
          }
        >
          <option value="private">仅自己可见</option>
          <option value="mentor">班主任可见</option>
        </select>
      </label>
      {error ? <p className="qitu-form-error">提交失败：{error.message}</p> : null}
      {result ? <p className="qitu-form-success">已提交反思（编号 {result.reflectionId}）。</p> : null}
      <button
        type="button"
        className="qitu-button qitu-button-primary"
        disabled={offline || pending || text.trim().length === 0}
        onClick={handleSubmit}
      >
        {pending ? '提交中…' : '提交反思'}
      </button>
    </SectionCard>
  );
}
