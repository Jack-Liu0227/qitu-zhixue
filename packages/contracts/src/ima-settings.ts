/** Safe admin projection; credentials and upstream document content are never returned. */
export interface AdminImaSettings {
  id: 'ima-knowledge';
  label: string;
  registered: boolean;
  enabled: boolean;
  status: 'connected' | 'error' | 'not_configured' | 'unknown';
  credentialConfigured: boolean;
  endpointOrigin: string | null;
  transport: 'streamable_http';
  tools: readonly string[];
  toolCount: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  assistants: readonly { id: string; name: string; enabled: boolean; authorized: boolean }[];
  agents: readonly { id: string; name: string; enabled: boolean; authorized: boolean; tools: readonly string[] }[];
}

export interface AdminImaSettingsPatch {
  enabled?: boolean;
  assistantBindings?: readonly { id: string; enabled: boolean }[];
  agentBindings?: readonly { id: string; enabled: boolean }[];
}
