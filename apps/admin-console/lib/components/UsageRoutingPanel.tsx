'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminModelUsagesResponse, AdminRuntimeSnapshot, ProviderConfigPublic } from '@qitu/contracts';
import { fetchUsages, newIdempotencyKey, bindUsage } from '../api/modelRegistry';
import { fetchRuntimeSnapshot, updateRuntimeAgent } from '../api/runtime';

export function UsageRoutingPanel({ providers }: { providers: ProviderConfigPublic[] }) {
  const [data, setData] = useState<AdminModelUsagesResponse | null>(null);
  const [runtime, setRuntime] = useState<AdminRuntimeSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const current = ++requestId.current;
    setData(null); setRuntime(null); setNotice(''); setError('');
    try {
      const [usages, snapshot] = await Promise.all([fetchUsages(), fetchRuntimeSnapshot()]);
      if (current !== requestId.current) throw new Error('配置读取已过期，请重新加载');
      setData(usages); setRuntime(snapshot); setError('');
      return { usages, snapshot };
    } catch (cause) {
      if (current === requestId.current) { setData(null); setRuntime(null); setNotice(''); setError(cause instanceof Error ? cause.message : '用途路由加载失败'); }
      throw cause;
    }
  }, []);
  useEffect(() => { void load().catch(() => {}); return () => { requestId.current++; }; }, [load, providers]);
  const options = runtime?.modelOptions?.filter((option) => option.available) ?? [];

  async function saveUsage(usageId: string, value: string) {
    setBusy(usageId); setError(''); setNotice('');
    try {
      const option = options.find((item) => JSON.stringify([item.providerId, item.modelId]) === value);
      if (!data || !runtime || (value && !option)) throw new Error('模型目录不可用，请重新加载后选择');
      await bindUsage(usageId, { providerId: option?.providerId ?? null, modelId: option?.modelId ?? null });
      const readback = (await load()).usages.bindings.find((item) => item.usageId === usageId);
      if (!readback || (readback.providerId ?? null) !== (option?.providerId ?? null) || (readback.modelId ?? null) !== (option?.modelId ?? null)) throw new Error('保存后的用途绑定回读不一致，请重新加载核验');
      setNotice('用途绑定已回读确认；采用该用途的链路将在下一次调用时生效。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(null); }
  }

  async function bindAgent(agentId: string, usage: string) {
    setBusy(agentId); setError(''); setNotice('');
    try {
      if (!data || !runtime) throw new Error('模型目录不可用，请重新加载');
      await updateRuntimeAgent(agentId, { modelUsage: usage, modelProviderId: null, modelId: null }, newIdempotencyKey());
      const agent = (await load()).snapshot.agents.find((item) => item.id === agentId);
      if (agent?.modelBinding !== 'usage' || agent.modelUsage !== usage) throw new Error('链路配置回读不一致，请重新加载核验');
      setNotice('链路已回读确认按用途自动分发，不再保留该 Agent 的模型覆盖。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '链路绑定失败'); }
    finally { setBusy(null); }
  }

  return <section className="provider-presets" aria-label="模型用途场景分发与链路绑定">
    <div className="runtime-section-head"><h2>模型用途场景分发与链路绑定</h2><span>管理员指定用途模型，链路自动遵循；学生不能自由切换。不会按模型名称猜测能力或静默换模。</span></div>
    {error ? <p role="alert" className="qitu-field-error">{error} <button disabled={busy !== null} onClick={() => void load().catch(() => {})}>重新加载</button></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!data && !error ? <p role="status">正在读取真实用途配置…</p> : null}
    <div className="provider-preset-grid">{data?.usages.map((usage) => {
      const binding = data.bindings.find((item) => item.usageId === usage.id);
      const compatible = options.filter((option) => (usage.requiresInput ?? []).every((m) => option.input.includes(m)) && usage.requiresOutput.every((m) => option.output.includes(m)));
      const value = binding?.providerId ? JSON.stringify([binding.providerId, binding.modelId]) : '';
      const actual = binding?.resolved;
      const available = actual && compatible.some((item) => item.providerId === actual.providerId && item.modelId === actual.modelId);
      // Embedding protocols are not declared by the chat-model catalog; do not guess.
      const unsupported = usage.id === 'knowledge.embed';
      return <div className="provider-preset" key={usage.id}><strong>{usage.label}</strong><code>{usage.id}</code><p>{usage.description}</p>
        <label>用途模型<select aria-label={`${usage.label}用途模型`} value={value} disabled={busy !== null || unsupported} onChange={(event) => void saveUsage(usage.id, event.target.value)}>
          <option value="">{usage.fallbackTo ? `继承 ${usage.fallbackTo}` : '未绑定（不可用）'}</option>
          {value && !compatible.some((item) => JSON.stringify([item.providerId, item.modelId]) === value) ? <option value={value}>当前绑定不可用</option> : null}
          {compatible.map((item) => <option key={JSON.stringify([item.providerId, item.modelId])} value={JSON.stringify([item.providerId, item.modelId])}>{item.label}</option>)}
        </select></label>
        <small>{unsupported ? '向量能力未接入本对话目录，请勿绑定聊天模型。' : available ? `生效：${actual.providerId} / ${actual.modelId}（配置可用，非推理验收）` : '不可用：未绑定、停用、缺少凭证或模态不匹配'}</small>
      </div>;
    })}</div>
    <h3>调用链路</h3><p>保留现有 Agent 专属配置；选择用途后，才会清除它的专属覆盖并跟随用途。密钥只保存在供应商端。</p>
    <div className="provider-preset-grid">{runtime?.agents.map((agent) => <div className="provider-preset" key={agent.id}>
      <strong>{agent.label}</strong><code>{agent.id}</code><small>{agent.modelBinding === 'usage' ? `按用途 ${agent.modelUsage} 自动分发` : 'Agent 专属覆盖'} · {agent.modelProviderId ?? '未配置'} / {agent.modelId ?? '未配置'}</small>
      <label>链路绑定<select aria-label={`${agent.label}链路绑定`} disabled={busy !== null} value={agent.modelBinding === 'usage' ? agent.modelUsage : ''} onChange={(event) => { if (event.target.value) void bindAgent(agent.id, event.target.value); }}>
        <option value="">保留专属覆盖</option>{data?.usages.filter((usage) => usage.id !== 'knowledge.embed' && usage.id !== 'tutor.live').map((usage) => <option key={usage.id} value={usage.id}>{usage.label}</option>)}
      </select></label>
    </div>)}</div>
    {providers.length === 0 ? <p>请先在模型通道中登记供应商和真实模型。</p> : null}
  </section>;
}
