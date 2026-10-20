'use client';

import { SectionCard } from '@qitu/ui';
import { useEffect, useRef, useState } from 'react';
import type { StudentGrowthAnalysisView } from '@qitu/contracts';
import { GrowthOfflineError, GrowthPermissionError } from '../data/growthDataSource';
import { AnalysisStatus } from './AnalysisStatus';

type State = { status: 'loading' } | { status: 'ready'; value: StudentGrowthAnalysisView }
  | { status: 'error' | 'offline' | 'permission'; message: string };

export function GrowthAnalysisCard({ load }: { load: () => Promise<StudentGrowthAnalysisView> }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const identity = useRef(0);
  useEffect(() => {
    const requestId = ++identity.current;
    setState({ status: 'loading' });
    load().then(value => {
      if (requestId === identity.current) setState({ status: 'ready', value });
    }).catch(error => {
      if (requestId !== identity.current) return;
      const status = error instanceof GrowthPermissionError ? 'permission' : error instanceof GrowthOfflineError ? 'offline' : 'error';
      setState({ status, message: status === 'permission' ? '当前账号无法查看成长归纳。'
        : status === 'offline' ? '恢复网络后可查看成长归纳。' : '成长归纳暂时无法读取，请稍后重试。' });
    });
    return () => { identity.current++; };
  }, [load, revision]);
  useEffect(() => {
    const online = () => setRevision(value => value + 1);
    const offline = () => { identity.current++; setState({ status: 'offline', message: '恢复网络后可查看成长归纳。' }); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  return <SectionCard title="成长助手的最新归纳">
    {state.status === 'loading' ? <p role="status">正在读取已确认的成长归纳…</p>
      : state.status !== 'ready' ? <div role="alert"><p>{state.message}</p>
        {state.status !== 'permission' && <button type="button" className="qitu-button" onClick={() => setRevision(value => value + 1)}>重新读取</button>}</div>
        : <>
          <AnalysisStatus analysis={state.value.analysis} />
          {state.value.trajectory ? <>
            <p>{state.value.trajectory.studentSummary ?? '新的探究记录正在积累。'}</p>
            {state.value.trajectory.milestones.length > 0 && <ul>{state.value.trajectory.milestones.map(item => <li key={item}>{item}</li>)}</ul>}
            {state.value.trajectory.nextQuestions.length > 0 && <div><strong>接下来可以探索</strong>
              <ul>{state.value.trajectory.nextQuestions.map(item => <li key={item}>{item}</li>)}</ul></div>}
          </> : <p>分享兴趣、探究过程和反思后，专任助手会继续整理你的成长线索。</p>}
        </>}
  </SectionCard>;
}
