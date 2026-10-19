import type { AdminAssistantConfig, AdminTeamConfig, AdminTeamMember } from '@qitu/contracts';

type Assistant = Pick<AdminAssistantConfig, 'id' | 'name' | 'role' | 'avatar' | 'instructions' | 'enabled' | 'sortOrder'>;
type Team = Pick<AdminTeamConfig, 'id' | 'name' | 'enabled'> & {
  members: readonly Pick<AdminTeamMember, 'assistantId'>[];
};

export interface CopilotAssistantOption {
  id: string;
  name: string;
  role: string;
  icon?: string;
  systemPrompt: string;
}

export interface CopilotAssistantGroup {
  id: string;
  label: string;
  assistants: CopilotAssistantOption[];
}

export function buildCopilotAssistantGroups(assistants: readonly Assistant[], teams: readonly Team[]): CopilotAssistantGroup[] {
  const enabled = [...assistants].filter((assistant) => assistant.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const byId = new Map(enabled.map((assistant) => [assistant.id, {
    id: assistant.id, name: assistant.name, role: assistant.role,
    icon: assistant.avatar, systemPrompt: assistant.instructions,
  }]));
  const grouped = new Set<string>();
  const groups: CopilotAssistantGroup[] = [];
  for (const team of teams.filter((candidate) => candidate.enabled)) {
    const members = [...new Set(team.members.map((member) => member.assistantId))]
      .flatMap((id) => {
        const assistant = byId.get(id);
        return assistant ? [assistant] : [];
      });
    if (members.length === 0) continue;
    members.forEach((member) => grouped.add(member.id));
    groups.push({ id: team.id, label: team.name, assistants: members });
  }
  const standalone = [...byId.values()].filter((assistant) => !grouped.has(assistant.id));
  if (standalone.length > 0) groups.unshift({ id: 'standalone', label: '未分组助手', assistants: standalone });
  return groups;
}

export function resolveCopilotSelection(groups: readonly CopilotAssistantGroup[], previousId: string): string {
  const assistants = groups.flatMap((group) => group.assistants);
  if (assistants.some((assistant) => assistant.id === previousId)) return previousId;
  return assistants.find((assistant) => assistant.id === 'qitu-assistant')?.id ?? assistants[0]?.id ?? '';
}

export type CopilotCatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; groups: CopilotAssistantGroup[] }
  | { kind: 'unavailable'; error: unknown };

export function createCopilotCatalogLoader(input: {
  loadAssistants: () => Promise<readonly Assistant[]>;
  loadTeams: () => Promise<readonly Team[]>;
  onChange: (state: CopilotCatalogState) => void;
}) {
  let revision = 0;
  return {
    async refresh(): Promise<CopilotAssistantGroup[] | null> {
      const request = ++revision;
      input.onChange({ kind: 'loading' });
      try {
        const [assistants, teams] = await Promise.all([input.loadAssistants(), input.loadTeams()]);
        if (request !== revision) return null;
        const groups = buildCopilotAssistantGroups(assistants, teams);
        input.onChange({ kind: 'ready', groups });
        return groups;
      } catch (error) {
        if (request === revision) input.onChange({ kind: 'unavailable', error });
        return null;
      }
    },
    unavailable(error: unknown) {
      revision += 1;
      input.onChange({ kind: 'unavailable', error });
    },
    dispose() { revision += 1; },
  };
}
