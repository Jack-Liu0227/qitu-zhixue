'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminAssistantConfig, GrowthProjectionSettingsView } from '@qitu/contracts';
import { fetchAdminAssistantConfigs, updatePersistedAssistant } from './api/assistants';
import { configuredModelKey, fetchAvailableConfiguredModels, type ConfiguredModelItem } from './api/configuredModels';
import { fetchGrowthProjectionSettings, saveGrowthProjectionSettings } from './api/growth-projection';
import { AdminApiError, newIdempotencyKey } from './api/types';

const errorText = (error: unknown) => error instanceof AdminApiError ? `${error.code}：${error.message}`
  : error instanceof Error ? error.message : '请求失败';

export function useGrowthProjectionSettings() {
  const [settings, setSettings] = useState<GrowthProjectionSettingsView | null>(null);
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [availableModels, setAvailableModels] = useState<ConfiguredModelItem[]>([]);
  const [profileAssistantId, setProfileAssistantId] = useState('');
  const [growthAssistantId, setGrowthAssistantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const requestIdentity = useRef(0);
  const inFlight = useRef(false);
  const mutationKeys = useRef(new Map<string, string>());
  const reload = useCallback(() => { if (!inFlight.current) setRevision(value => value + 1); }, []);

  useEffect(() => {
    const identity = ++requestIdentity.current;
    setLoading(true);
    setError(null);
    Promise.all([fetchGrowthProjectionSettings(), fetchAdminAssistantConfigs(), fetchAvailableConfiguredModels()])
      .then(([view, configs, models]) => {
        if (identity !== requestIdentity.current) return;
        setSettings(view);
        setAssistants(configs);
        setAvailableModels(models);
        setProfileAssistantId(view.settings.profileAssistantId ?? '');
        setGrowthAssistantId(view.settings.growthAssistantId ?? '');
        mutationKeys.current.clear();
      }).catch(reason => {
        if (identity === requestIdentity.current) setError(errorText(reason));
      }).finally(() => { if (identity === requestIdentity.current) setLoading(false); });
    return () => { requestIdentity.current++; };
  }, [revision]);

  const keyFor = (signature: string) => {
    const current = mutationKeys.current.get(signature);
    if (current) return current;
    const key = newIdempotencyKey();
    mutationKeys.current.set(signature, key);
    return key;
  };

  const save = async () => {
    if (inFlight.current || loading || error || !settings) return;
    const ids = [...new Set([profileAssistantId, growthAssistantId].filter(Boolean))];
    const targets = ids.map(id => assistants.find(assistant => assistant.id === id));
    if (targets.some(target => !target || !settings.assistants.some(option => option.id === target.id)
      || !availableModels.some(model => model.providerId === target.modelProviderId && model.id === target.modelId))) {
      setNotice('请选择当前可用的专任助手及完整的供应商与模型绑定。');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setNotice('正在保存助手模型与用途绑定…');
    try {
      const results = await Promise.allSettled(targets.map(target => {
        if (!target) throw new Error('助手目录已变化');
        const patch = { modelProviderId: target.modelProviderId, modelId: target.modelId };
        return updatePersistedAssistant(target.id, patch, keyFor(`assistant:${target.id}:${JSON.stringify(patch)}`));
      }));
      const failed = results.flatMap((result, index) => result.status === 'rejected'
        ? [`${targets[index]?.name ?? ids[index]}：${errorText(result.reason)}`] : []);
      if (failed.length) throw new Error(`部分模型配置未完成，用途绑定尚未提交。${failed.join('；')}`);
      const readback = await fetchAdminAssistantConfigs();
      if (targets.some(target => !target || !readback.some(saved => saved.id === target.id
        && saved.modelProviderId === target.modelProviderId && saved.modelId === target.modelId))) {
        throw new Error('模型写入后回读不一致，用途绑定尚未提交');
      }
      const value = { profileAssistantId: profileAssistantId || null, growthAssistantId: growthAssistantId || null };
      await saveGrowthProjectionSettings(settings.revision, value, keyFor(`purposes:${settings.revision}:${JSON.stringify(value)}`));
      const verified = await fetchGrowthProjectionSettings();
      if (verified.settings.profileAssistantId !== value.profileAssistantId
        || verified.settings.growthAssistantId !== value.growthAssistantId) {
        throw new Error('用途绑定写入后回读不一致，请重新读取配置');
      }
      setSettings(verified);
      setAssistants(readback);
      mutationKeys.current.clear();
      setNotice('助手用途与模型绑定已回读确认。新任务按该配置选择助手；生成内容仍需服务端审核后展示。');
    } catch (reason) {
      setNotice(`${errorText(reason)}。未确认全部生效，可重试同一操作或重新读取核验。`);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const modelValue = (id: string) => {
    const assistant = assistants.find(item => item.id === id);
    return assistant?.modelId ? configuredModelKey({ providerId: assistant.modelProviderId ?? '', id: assistant.modelId }) : '';
  };
  return {
    settings, assistants, setAssistants, availableModels, profileAssistantId, setProfileAssistantId,
    growthAssistantId, setGrowthAssistantId, loading, saving, error, notice, reload, save,
    ready: !loading && !error && settings !== null,
    profileModelValue: modelValue(profileAssistantId), growthModelValue: modelValue(growthAssistantId),
  };
}
