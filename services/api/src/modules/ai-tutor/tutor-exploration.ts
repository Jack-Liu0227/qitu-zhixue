import { ConflictException } from '@nestjs/common';
import type { AdminTeamConfig, ExplorationView, TutorProjectContext, TutorTeamIdentity } from '@qitu/contracts';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { CompiledTeachingRole } from '../templates/teaching-bundle.types';

export async function resolveExplorationHandoff(input: {
  ownerId: string; exploration?: ExplorationView; fallback: TutorTeamIdentity;
  bindings?: TemplateBindingService; registry?: PlatformRegistryService;
  loadTeam: (id: string, bindingId: string) => Promise<AdminTeamConfig | null>;
}): Promise<{ team: TutorTeamIdentity; teamConfig: AdminTeamConfig | null; exploration: NonNullable<TutorProjectContext['exploration']>; role: CompiledTeachingRole | null }> {
  const { exploration, bindings, registry } = input;
  const meta: NonNullable<TutorProjectContext['exploration']> = {
    id: exploration?.id ?? null, templateVersionId: exploration?.templateVersionId ?? null,
    title: exploration?.intentDraft?.goalUser?.trim() || '自由探索', drivingQuestion: null, handoff: 'free',
  };
  if (!exploration?.templateVersionId) return { team: input.fallback, teamConfig: null, exploration: meta, role: null };
  meta.handoff = 'pending';
  if (!bindings || !registry) return { team: input.fallback, teamConfig: null, exploration: meta, role: null };
  const preview = await bindings.getExplorationBinding(input.ownerId, exploration.templateVersionId);
  meta.title = preview.title;
  const spec = preview.content.pbl && typeof preview.content.pbl === 'object' ? preview.content.pbl : preview.content;
  const theme = 'theme' in spec ? spec.theme : null;
  if (theme && typeof theme === 'object' && 'drivingQuestion' in theme && typeof theme.drivingQuestion === 'string') {
    meta.drivingQuestion = theme.drivingQuestion;
  }
  if (!preview.binding) return { team: input.fallback, teamConfig: null, exploration: meta, role: null };
  const team = await input.loadTeam(preview.binding.teamVersionId, preview.binding.id);
  const assistants = await registry.listAssistants();
  const assistant = assistants.find((entry) => entry.id === team?.leaderAssistantId && entry.enabled);
  if (!team?.enabled || !assistant || !team.members.some((entry) => entry.assistantId === assistant.id)) {
    throw new ConflictException({ code: 'TEMPLATE_TEAM_UNAVAILABLE', message: '模板导师暂不可用，请联系管理员或先自由探索。' });
  }
  const roles = preview.bundle?.roles.filter((entry) => entry.assistantId === assistant.id) ?? [];
  if (preview.bundle && (roles.length !== 1 || preview.bundle.teamVersion.teamVersionId !== preview.binding.teamVersionId)) {
    throw new ConflictException({ code: 'TEMPLATE_TEACHING_ROUTE_INVALID', message: '模板探索导师配置不完整，请联系管理员。' });
  }
  meta.handoff = 'ready';
  return { exploration: meta, teamConfig: team, role: roles[0] ?? null, team: {
    teamId: team.id, teamName: team.name, assistantId: assistant.id, assistantName: assistant.name,
    assistantAvatar: assistant.avatar ?? null,
  } };
}
