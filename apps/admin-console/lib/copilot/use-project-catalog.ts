'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  fetchAdminTemplates, fetchAdminTemplateVersions,
  type AdminProjectTemplate, type AdminTemplateVersionDetail,
} from '../api/content';

export function useProjectCatalog(templateId: string | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    templateId: string | null; loading: boolean; error: string | null;
    templates: AdminProjectTemplate[]; versions: AdminTemplateVersionDetail[];
  }>({ templateId, loading: true, error: null, templates: [], versions: [] });
  useEffect(() => {
    let current = true;
    setState(s => ({ ...s, templateId, loading: true, error: null, versions: [] }));
    Promise.all([
      fetchAdminTemplates(),
      templateId ? fetchAdminTemplateVersions(templateId) : Promise.resolve([]),
    ]).then(([templates, versions]) => {
      if (!current) return;
      setState({ templateId, loading: false,
        error: templateId && !templates.some(t => t.id === templateId) ? '所选项目已删除或无权访问，请重新选择。' : null,
        templates, versions: [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }).catch(error => {
      if (current) setState(s => ({ ...s, templateId, loading: false,
        error: error instanceof Error ? error.message : '项目目录读取失败', versions: [] }));
    });
    return () => { current = false; };
  }, [templateId, revision]);
  return { ...state, loading: state.loading || state.templateId !== templateId,
    refresh: useCallback(() => setRevision(n => n + 1), []) };
}
