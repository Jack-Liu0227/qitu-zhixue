import type { AdminAssistantConfig, AdminTeamConfig, AdminTeamMember } from '@qitu/contracts';

type Assistant = Pick<AdminAssistantConfig, 'id' | 'name' | 'role' | 'avatar' | 'instructions' | 'enabled' | 'sortOrder'>;
type Team = Pick<AdminTeamConfig, 'id' | 'name' | 'enabled' | 'leaderAssistantId'> & {
  members: readonly Pick<AdminTeamMember, 'assistantId'>[];
};

export interface CopilotAssistantOption {
  id: string;
  name: string;
  role: string;
  icon?: string;
  systemPrompt: string;
}

export interface CopilotTeamOption {
  id: string;
  name: string;
  memberCount: number;
  leaderAssistantId: string;
}

export interface CopilotCatalog {
  assistants: CopilotAssistantOption[];
  teams: CopilotTeamOption[];
}

const DEFAULT_QITU_ASSISTANT_OPTION: CopilotAssistantOption = {
  id: 'qitu-assistant',
  name: '启途智学管家',
  role: '平台管理助手 (Copilot)',
  icon: '🏛️',
  systemPrompt: '你是启途智学平台的专属 AI 管家，负责协助管理员配置项目模板、管理教研团队、监控模型调用及解答平台治理相关问题。',
};

/**
 * Build two independent display registries. A team is not an assistant group:
 * teams select a collaboration scope, while assistants select one enabled
 * runtime identity. Team members are never copied into the team label list.
 */
export function buildCopilotCatalog(assistants: readonly Assistant[], teams: readonly Team[]): CopilotCatalog {
  const enabled = [...assistants].filter((assistant) => assistant.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const options: CopilotAssistantOption[] = enabled.map((assistant) => ({
    id: assistant.id, name: assistant.name, role: assistant.role,
    icon: assistant.avatar, systemPrompt: assistant.instructions,
  }));
  if (!options.some((assistant) => assistant.id === 'qitu-assistant')) {
    const raw = assistants.find((assistant) => assistant.id === 'qitu-assistant');
    if (raw) {
      options.unshift({
        id: raw.id, name: raw.name, role: raw.role,
        icon: raw.avatar, systemPrompt: raw.instructions,
      });
    } else {
      options.unshift(DEFAULT_QITU_ASSISTANT_OPTION);
    }
  }
  const enabledTeams = teams.filter((team) => team.enabled)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({
      id: team.id,
      name: team.name,
      memberCount: new Set(team.members.map((member) => member.assistantId)
        .filter((assistantId) => enabled.some((assistant) => assistant.id === assistantId))).size,
      leaderAssistantId: team.leaderAssistantId,
    }));
  return { assistants: options, teams: enabledTeams };
}

export function resolveCopilotSelection(assistants: readonly CopilotAssistantOption[], previousId: string): string {
  if (assistants.some((assistant) => assistant.id === previousId)) return previousId;
  return assistants.find((assistant) => assistant.id === 'qitu-assistant')?.id ?? assistants[0]?.id ?? '';
}

export function resolveCopilotTeamSelection(teams: readonly CopilotTeamOption[], previousId: string): string {
  return teams.some((team) => team.id === previousId) ? previousId : '';
}

export type CopilotCatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; catalog: CopilotCatalog }
  | { kind: 'unavailable'; error: unknown };

export function createCopilotCatalogLoader(input: {
  loadAssistants: () => Promise<readonly Assistant[]>;
  loadTeams: () => Promise<readonly Team[]>;
  onChange: (state: CopilotCatalogState) => void;
}) {
  let revision = 0;
  return {
    async refresh(): Promise<CopilotCatalog | null> {
      const request = ++revision;
      input.onChange({ kind: 'loading' });
      try {
        const [assistants, teams] = await Promise.all([input.loadAssistants(), input.loadTeams()]);
        if (request !== revision) return null;
        const catalog = buildCopilotCatalog(assistants, teams);
        input.onChange({ kind: 'ready', catalog });
        return catalog;
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
