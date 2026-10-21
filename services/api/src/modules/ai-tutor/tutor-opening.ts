import type { PblPhase, TutorProjectContext, TutorReplyBlock } from '@qitu/contracts';
import { pblPhaseForProjectStage } from '../../common/pbl-phase';
import { buildProjectInteractionBlocks } from './tutor-interactive-blocks';

export function buildExplorationOpeningBlocks(context: TutorProjectContext): TutorReplyBlock[] {
  const meta = context.exploration;
  const template = Boolean(meta?.templateVersionId);
  const name = context.team?.assistantName ?? '启途智学助手';
  const greeting = template
    ? `你好，我是${name}。我们从「${meta!.title}」开始探索。${meta?.handoff === 'ready' ? `\n\n${context.team?.teamName}将陪你梳理问题，确认项目后再按课时开展学习。` : '\n\n模板导师配置尚待管理员完善，我会先陪你整理兴趣和问题。'}`
    : `你好，我是${name}，你的探索搭档。\n\n最近有什么让你好奇的现象，或想亲手做出的东西？还没有想法也没关系，我们可以从一件小事聊起。`;
  return [
    { kind: 'text', text: greeting },
    ...(meta?.drivingQuestion ? [{ kind: 'text' as const, text: `这次的探究问题：${meta.drivingQuestion}\n\n你已经观察到了什么？` }] : []),
    { kind: 'options', allowOther: true, items: template ? [
      { label: '先了解挑战', text: `请用一个贴近日常的例子，带我认识「${meta!.title}」要探究的问题，先不要创建项目。` },
      { label: '聊聊我的观察', text: '我想先说说我观察到的现象，请一次问我一个问题。' },
      { label: '我想做什么作品', text: '我想围绕这个主题做一个作品，请帮我整理可行的想法，确认前先不创建项目。' },
    ] : [
      { label: '从生活现象开始', text: '请用一个生活中的有趣现象，帮我找到想研究的问题。' },
      { label: '我想动手做东西', text: '我想动手做一个小作品，请先问问我的兴趣和条件。' },
      { label: '还没有想法', text: '我还没有想法，请给我几个不同方向，并一次问我一个问题。' },
    ] },
    { kind: 'text', text: '这里先交流想法。只有你明确确认后，才会创建正式项目；理论过关后再进入实践。' },
  ];
}

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
