'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../api/assistants';
import { fetchAdminTeamConfigs } from '../api/teams';
import { AdminOfflineError, AdminPermissionError } from '../api/types';
import { createCopilotCatalogLoader, type CopilotCatalogState } from './assistant-catalog';

export function useAssistantCatalog() {
  const [state, setState] = useState<CopilotCatalogState>({ kind: 'loading' });
  const loader = useMemo(() => createCopilotCatalogLoader({
    loadAssistants: fetchAdminAssistantConfigs,
    loadTeams: fetchAdminTeamConfigs,
    onChange: setState,
  }), []);

  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine) loader.unavailable(new AdminOfflineError());
      else void loader.refresh();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    const onOffline = () => loader.unavailable(new AdminOfflineError());
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      loader.dispose();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loader]);

  const error = state.kind !== 'unavailable' ? null
    : state.error instanceof AdminPermissionError ? '没有读取助手或团队目录的权限，请重新登录或联系管理员。'
      : state.error instanceof AdminOfflineError ? '网络不可用，已停用助手选择；恢复联网后自动刷新。'
        : '助手或团队目录读取失败，未使用本地缓存或预设名单。请重试。';
  return { state, error, refresh: loader.refresh };
}
