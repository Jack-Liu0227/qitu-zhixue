'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAvailableConfiguredModels, configuredModelKey, type ConfiguredModelItem } from '../api/configuredModels';
import { bindUsage, fetchUsages, newIdempotencyKey } from '../api/modelRegistry';

const USAGE = 'admin.copilot';

export function useCopilotModel() {
  const [availableModels, setAvailableModels] = useState<ConfiguredModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelNotice, setModelNotice] = useState('');
  const identity = useRef(0);
  const load = useCallback(async () => {
    const request = ++identity.current;
    setModelError(null);
    try {
      const [models, usages] = await Promise.all([fetchAvailableConfiguredModels(), fetchUsages()]);
      if (request !== identity.current) return;
      setAvailableModels(models);
      const selection = usages.bindings.find((row) => row.usageId === USAGE)?.resolved;
      const current = selection ? models.find((row) => row.providerId === selection.providerId && row.id === selection.modelId) : undefined;
      setSelectedModel(current ? configuredModelKey(current) : '');
      if (selection && !current) setModelError('已保存的管家默认模型当前不可用，请重新选择。');
    } catch (failure) {
      if (request === identity.current) {
        setAvailableModels([]); setSelectedModel('');
        setModelError(failure instanceof Error ? failure.message : '默认模型读取失败');
      }
    }
  }, []);
  useEffect(() => { void load(); return () => { identity.current++; }; }, [load]);

  async function handleModelChange(key: string) {
    if (modelSaving) return;
    const model = availableModels.find((row) => configuredModelKey(row) === key);
    if (!model) { setModelError('模型目录已变化，请重新加载。'); return; }
    const request = ++identity.current;
    setModelSaving(true); setModelError(null); setModelNotice('');
    try {
      await bindUsage(USAGE, { providerId: model.providerId, modelId: model.id }, newIdempotencyKey());
      const readback = (await fetchUsages()).bindings.find((row) => row.usageId === USAGE);
      if (readback?.providerId !== model.providerId || readback.modelId !== model.id) throw new Error('默认模型回读不一致，请重新加载核对。');
      if (request !== identity.current) return;
      setSelectedModel(key); setModelNotice('默认模型已保存，刷新或新建对话时自动使用。');
    } catch (failure) {
      if (request === identity.current) setModelError(failure instanceof Error ? failure.message : '默认模型保存未确认，请重试。');
    } finally { if (request === identity.current) setModelSaving(false); }
  }
  return { availableModels, selectedModel, modelError, modelSaving, modelNotice, handleModelChange, reloadModels: load };
}
