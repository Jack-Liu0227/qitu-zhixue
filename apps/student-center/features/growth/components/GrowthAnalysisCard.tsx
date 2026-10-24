'use client';

import { SectionCard, ResizablePanels } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudentGrowthAnalysisView } from '@qitu/contracts';
import { GrowthOfflineError, GrowthPermissionError } from '../data/growthDataSource';
import { AnalysisStatus } from './AnalysisStatus';
import { useAnalysisRefresh } from '../useAnalysisRefresh';

type State = { status: 'loading' } | { status: 'ready'; value: StudentGrowthAnalysisView }
  | { status: 'error' | 'offline' | 'permission'; message: string };

export function GrowthAnalysisCard({ load }: { load: () => Promise<StudentGrowthAnalysisView> }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const identity = useRef(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useAnalysisRefresh(reload);
  useEffect(() => {
    const requestId = ++identity.current;
    setState(current => current.status === 'ready' ? current : { status: 'loading' });
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

  return <div className="qitu-growth-analysis"><SectionCard title="成长助手的最新归纳">
    {state.status === 'loading' ? <p role="status">正在读取已确认的成长归纳…</p>
      : state.status !== 'ready' ? <div role="alert"><p>{state.message}</p>
        {state.status !== 'permission' && <button type="button" className="qitu-button" onClick={() => setRevision(value => value + 1)}>重新读取</button>}</div>
        : <>
          <AnalysisStatus analysis={state.value.analysis} />
          {state.value.trajectory ? <>
            <p className="qitu-growth-analysis-lead">{state.value.trajectory.studentSummary ?? '新的探究记录正在积累。'}</p>
            <ResizablePanels storageKey="student-growth-summary" initialSizes={[56, 44]} minWidths={[300, 260]} className="qitu-growth-analysis-grid" labels={['成长足迹', '探索建议']}>
              {state.value.trajectory.milestones.length > 0 && <div>
                <h3>最近的成长足迹</h3>
                <ul className="qitu-growth-milestones">{state.value.trajectory.milestones.slice(0, 4).map(item => <li key={item}>{item}</li>)}</ul>
                {state.value.trajectory.milestones.length > 4 && <details className="qitu-growth-more"><summary>查看其余 {state.value.trajectory.milestones.length - 4} 条足迹</summary>
                  <ul className="qitu-growth-milestones">{state.value.trajectory.milestones.slice(4).map(item => <li key={item}>{item}</li>)}</ul>
                </details>}
              </div>}
              {state.value.trajectory.nextQuestions.length > 0 && <div className="qitu-growth-next"><h3>带着问题继续探索</h3>
                <ul>{state.value.trajectory.nextQuestions.map(item => <li key={item}>{item}</li>)}</ul></div>}
            </ResizablePanels>
          </> : <p>分享兴趣、探究过程和反思后，专任助手会继续整理你的成长线索。</p>}
        </>}
  </SectionCard></div>;
}
