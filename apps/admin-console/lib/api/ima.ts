/** Compatibility projection for the retained matrix layout; writes use the same revision as JSON. */
import type { AdminImaSettings, AdminImaSettingsPatch } from '@qitu/contracts';
import { fetchAdminAssistantConfigs } from './assistants';
import { fetchCenterConfig, saveCenterConfig, type CenterConfig } from './knowledge-center';
let current: CenterConfig | null = null;
export async function fetchImaSettings(): Promise<AdminImaSettings> {
  const [state, assistants] = await Promise.all([
    fetchCenterConfig(),
    fetchAdminAssistantConfigs(),
  ]);
  current = state;
  const tool = state.config.platformTools['project-knowledge'];
  return {
    id: 'ima-knowledge',
    label: tool.name,
    registered: true,
    enabled: tool.enabled,
    status: 'unknown',
    credentialConfigured: false,
    endpointOrigin: null,
    transport: 'streamable_http',
    tools: tool.tools,
    toolCount: tool.tools.length,
    lastCheckedAt: null,
    lastError: null,
    assistants: assistants.map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      authorized: tool.boundAssistants.includes(a.id),
    })),
    agents: [],
  };
}
export async function saveImaSettings(
  patch: AdminImaSettingsPatch,
  key: string,
): Promise<AdminImaSettings> {
  if (!current) throw new Error('请先读取服务器配置');
  const config = structuredClone(current.config);
  const tool = config.platformTools['project-knowledge'];
  if (patch.enabled !== undefined) tool.enabled = patch.enabled;
  for (const binding of patch.assistantBindings ?? [])
    tool.boundAssistants = binding.enabled
      ? [...new Set([...tool.boundAssistants, binding.id])]
      : tool.boundAssistants.filter((id) => id !== binding.id);
  current = await saveCenterConfig({ expectedRevision: current.revision, config }, key);
  return fetchImaSettings();
}
export async function checkImaConnection(_key: string): Promise<AdminImaSettings> {
  return fetchImaSettings();
}
