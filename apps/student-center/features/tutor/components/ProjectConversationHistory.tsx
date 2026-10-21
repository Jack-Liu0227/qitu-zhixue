'use client';

import { useEffect, useState } from 'react';
import type { TutorTurn } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { ChatBubble } from './ChatBubble';

export function ProjectConversationHistory({ projectId }: { projectId: string }) {
  const source = useTutorDataSource();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    if (!open || !source.getProjectConversationHistory) return;
    setStatus('loading'); setTurns([]);
    void source.getProjectConversationHistory(projectId).then(result => {
      if (current) { setTurns(result?.turns ?? []); setStatus('ready'); }
    }).catch((failure: unknown) => {
      if (current) { setError(failure instanceof Error ? failure.message : '读取失败'); setStatus('error'); }
    });
    return () => { current = false; };
  }, [source, projectId, open]);
  if (!source.getProjectConversationHistory) return null;
  return <section aria-label="项目历史对话">
    <button type="button" className="qitu-button qitu-button-ghost" onClick={() => setOpen(value => !value)}>{open ? '收起历史对话' : '查看已有对话（只读）'}</button>
    {open && <>
      <p>以下是原有记录。导师配置恢复后才能继续答题、实验与提交。</p>
      {status === 'loading' ? <p role="status">正在读取历史对话…</p> : status === 'error' ? <p role="alert">{error}</p>
        : turns.length ? turns.map(turn => <ChatBubble key={turn.turnId} turn={turn} disabled streaming={false} onSelectOption={() => {}} />)
          : <p>这个项目尚无已保存的对话。</p>}
    </>}
  </section>;
}
