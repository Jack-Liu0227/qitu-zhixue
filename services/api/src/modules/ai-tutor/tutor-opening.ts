import type { PblPhase, TutorProjectContext, TutorReplyBlock } from '@qitu/contracts';
import { pblPhaseForProjectStage } from '../../common/pbl-phase';
import { buildProjectInteractionBlocks } from './tutor-interactive-blocks';

/** Called only with the owner's frozen project/team projection, never a title classifier. */
export function buildProjectOpeningBlocks(context: TutorProjectContext): TutorReplyBlock[] {
  const { project, team, phases } = context;
  if (!project || !team?.teamId || !phases?.length) return [];
  const activePhase = phases.find((phase) => phase.status === 'active');
  const phaseId = pblPhaseForProjectStage(project.stage);
  if (!isPblPhase(phaseId)) return [];
  const phase = phaseId;
  const question = phase === 'exploration'
    ? '关于这个项目，你最想先弄清哪一个问题？'
    : '围绕当前任务，你已经尝试了哪一步？';
  return [
    {
      kind: 'pbl_card', phase, title: project.title,
      teammateLabel: `${team.assistantName} · ${team.teamName ?? ''}`,
      summary: activePhase ? `当前阶段：${activePhase.name}。回答与探究产生证据后，再由服务端决定下一步。` : '先交流你的问题与已有观察，再一起确定下一步。',
    },
    { kind: 'text', text: `你好，我是${team.assistantName}，由${team.teamName ?? '项目导师团队'}陪伴你探索「${project.title}」。\n\n${question}` },
    ...buildProjectInteractionBlocks(context),
  ];
}

function isPblPhase(value: string): value is PblPhase {
  return value === 'exploration' || value === 'concept_mastery'
    || value === 'guided_practice' || value === 'deliverable_review';
}
