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

/**
 * Build two independent display registries. A team is not an assistant group:
 * teams select a collaboration scope, while assistants select one enabled
 * runtime identity. Team members are never copied into the team label list.
 */
export function buildCopilotCatalog(assistants: readonly Assistant[], teams: readonly Team[]): CopilotCatalog {
  const enabled = [...assistants].filter((assistant) => assistant.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const options = enabled.map((assistant) => ({
    id: assistant.id, name: assistant.name, role: assistant.role,
    icon: assistant.avatar, systemPrompt: assistant.instructions,
  }));
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
