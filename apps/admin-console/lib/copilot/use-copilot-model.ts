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
  const [modelLoading, setModelLoading] = useState(true);
  const [modelIsDefault, setModelIsDefault] = useState(false);
  const identity = useRef(0);
  const saving = useRef(false);
  const attempt = useRef<{ key: string; model: string } | null>(null);
  const load = useCallback(async () => {
    if (saving.current) return;
    const request = ++identity.current;
    setModelLoading(true); setModelError(null); setModelNotice('');
    try {
      const [models, usages] = await Promise.all([fetchAvailableConfiguredModels(), fetchUsages()]);
      if (request !== identity.current) return;
      setAvailableModels(models);
      const binding = usages.bindings.find((row) => row.usageId === USAGE);
      const selection = binding?.resolved;
      const current = selection ? models.find((row) => row.providerId === selection.providerId && row.id === selection.modelId) : undefined;
      setSelectedModel(current ? configuredModelKey(current) : '');
      setModelIsDefault(Boolean(binding?.providerId && binding.modelId));
      if (current) setModelNotice(binding?.providerId ? '已读取保存的管家默认模型。' : '当前跟随平台用途模型，可将当前模型设为管家默认。');
      if (selection && !current) setModelError('已保存的管家默认模型当前不可用，请重新选择。');
    } catch (failure) {
      if (request === identity.current) {
        setAvailableModels([]); setSelectedModel('');
        setModelError(failure instanceof Error ? failure.message : '默认模型读取失败');
      }
    } finally { if (request === identity.current) setModelLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { identity.current++; }; }, [load]);

  async function handleModelChange(key: string) {
    if (saving.current || modelLoading) return;
    const model = availableModels.find((row) => configuredModelKey(row) === key);
    if (!model) { setModelError('模型目录已变化，请重新加载。'); return; }
    const request = ++identity.current;
    saving.current = true;
    if (attempt.current?.model !== key) attempt.current = { model: key, key: newIdempotencyKey() };
    setModelSaving(true); setModelError(null); setModelNotice('');
    try {
      await bindUsage(USAGE, { providerId: model.providerId, modelId: model.id }, attempt.current.key);
      const readback = (await fetchUsages()).bindings.find((row) => row.usageId === USAGE);
      if (readback?.providerId !== model.providerId || readback.modelId !== model.id
        || readback.resolved?.providerId !== model.providerId || readback.resolved.modelId !== model.id) throw new Error('默认模型回读不一致，请重新加载核对。');
      if (request !== identity.current) return;
      attempt.current = null;
      setSelectedModel(key); setModelIsDefault(true); setModelNotice('默认模型已保存，刷新或新建对话时自动使用。');
    } catch (failure) {
      if (request === identity.current) setModelError(failure instanceof Error ? failure.message : '默认模型保存未确认，请重试。');
    } finally { saving.current = false; if (request === identity.current) setModelSaving(false); }
  }
  return { availableModels, selectedModel, modelError, modelSaving, modelLoading, modelIsDefault, modelNotice, handleModelChange, reloadModels: load };
}
