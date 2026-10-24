import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { projectStageLabel, type CurrentUser, type ParentHomePageData, type ParentMessage,
  type ParentMessagesPageData, type ParentProgressPageData, type ParentWeeklySummary } from '@qitu/contracts';
import { DirectoryService } from '../directory/directory.service';
import { GrowthService } from '../growth/growth.service';
import { LearningInsightsService } from '../learning-insights/learning-insights.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { currentStudentProject } from '../projects/current-project';
import { WorksService } from '../works/works.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ParentCommunicationService } from './parent-communication.service';
import { ProjectEvidenceMaterializer } from '../works/project-evidence.service';
import { AuditWriter } from '../../common/audit/audit.service';

@Injectable()
export class ParentLearningReadService {
  constructor(private readonly directory: DirectoryService, private readonly growth: GrowthService,
    private readonly insights: LearningInsightsService, private readonly plans: LearningPlanStore,
    private readonly works: WorksService, private readonly feedback: FeedbackService,
    private readonly communication: ParentCommunicationService,
    @Optional() private readonly evidence?: ProjectEvidenceMaterializer,
    @Optional() private readonly audit?: AuditWriter) {}

  async dashboard(actor: CurrentUser, childId: string): Promise<ParentHomePageData> {
    const student = await this.authorize(actor, childId);
    const [activity, projects, artifacts, page, tickets] = await Promise.all([
      this.insights.activity(childId), this.plans.listProjectsByStudent(childId),
      this.works.listArtifacts(actor, {}), this.parentGrowth(childId), this.feedback.listForParent(actor.id, childId),
    ]);
    const current = currentStudentProject(projects);
    const formal = projects.filter(project => project.status !== 'exploration');
    const task = current ? await this.currentTask(childId, current.id) : null;
    const weeklySummary: ParentWeeklySummary = { completed: [], praised: [], growing: [] };
    const entries = page.timeline.items.filter(entry => entry.occurredAt >= activity.weekStart);
    for (const entry of entries) {
      if (entry.type === 'reflection_created') weeklySummary.growing.push(entry.summaryParent);
      else weeklySummary.completed.push(entry.summaryParent);
    }
    // Praise refers to a saved action, never inferred ability or AI-generated personality.
    if (activity.activeDays > 0) weeklySummary.praised.push(`本周已有 ${activity.activeDays} 天留下学习记录，可以肯定孩子持续参与的行动。`);
    if (activity.sessionsThisWeek > 0) weeklySummary.completed.push(`本周已留下 ${activity.sessionsThisWeek} 次学习活动记录。`);
    if (activity.completedSessionsThisWeek > 0) weeklySummary.completed.push(`本周已完成 ${activity.completedSessionsThisWeek} 个课时，可以邀请孩子分享其中一个收获。`);
    if (task?.next) weeklySummary.growing.push(`正在继续探究：${task.next}`);
    for (const key of ['completed', 'praised', 'growing'] as const) weeklySummary[key] = [...new Set(weeklySummary[key])].slice(0, 4);
    const open = tickets.filter(ticket => ticket.status !== 'resolved');
    return {
      childId, childDisplayName: student.displayName, dataSource: 'live', hasAnyProject: formal.length > 0,
      kpis: [
        { id: 'weekly_sessions', label: '本周学习次数', value: `${activity.sessionsThisWeek} 次`,
          hint: '按实际学习活动统计，间隔超过 30 分钟另计一次', trend: trend(activity.sessionsThisWeek, activity.sessionsLastWeek) },
        { id: 'weekly_minutes', label: '本周学习时长（估算）', value: `${activity.minutesThisWeek} 分钟`,
          hint: '按相邻学习活动间隔估算，每段最多计 5 分钟', trend: trend(activity.minutesThisWeek, activity.minutesLastWeek) },
        { id: 'current_progress', label: '当前项目进度', value: current ? `${current.progressPercent}%` : formal.length ? '已完成' : '未开始',
          hint: '来自项目阶段记录，不代表知识掌握比例', trend: 'flat' },
        { id: 'streak', label: '连续成长记录天数', value: `${page.summary.streakDays} 天`, hint: '来自已确认的成长档案', trend: 'flat' },
      ],
      currentProject: current ? { projectId: current.id, title: current.title, summary: current.subtitle ?? '',
        stage: current.status, stageLabel: projectStageLabel(current.status), progressPercent: current.progressPercent,
        todayTask: task?.next ?? null, lastCompleted: task?.last ?? null, nextStep: task?.next ?? null } : null,
      attention: open.slice(0, 3).map(ticket => ({ id: ticket.id, level: ticket.status === 'replied' ? 'attention' : 'info',
        title: ticket.status === 'replied' ? '班主任已回复，等待您确认' : '反馈正在处理中', detail: ticket.problem.slice(0, 120) })),
      suggestedQuestion: activity.sessionsThisWeek > 0 || current ? {
        text: '最近的探究中，你观察到了什么，下一步想用什么证据验证？', projectTitle: current?.title ?? null,
      } : null,
      weeklySummary,
      recentArtifacts: artifacts.filter(item => item.studentId === childId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
        .map(item => ({ artifactRef: item.id, title: item.title, createdAt: item.updatedAt })),
    };
  }

  async progress(actor: CurrentUser, childId: string, artifactRef?: string): Promise<ParentProgressPageData> {
    await this.authorize(actor, childId);
    const [artifacts, projects, page] = await Promise.all([
      this.works.listArtifacts(actor, {}), this.plans.listProjectsByStudent(childId), this.parentGrowth(childId),
    ]);
    const owned = artifacts.filter(item => item.studentId === childId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const works: ParentProgressPageData['works'] = owned.map(item => ({
      artifactRef: item.id, title: item.title, summary: item.summary,
      status: item.status === 'published' ? 'completed' : item.status === 'draft' ? 'draft' : 'in_progress',
      versionLabel: item.versionCount ? `V${item.currentVersionIndex}` : null,
      progressPercent: projects.find(project => project.id === item.projectId)?.progressPercent ?? 0,
      tags: item.tags, updatedAt: item.updatedAt,
    }));
    const focusWork = artifactRef ? works.find(work => work.artifactRef === artifactRef) : works.find(work => work.status === 'in_progress') ?? works[0];
    if (artifactRef && !focusWork) throw new ForbiddenException('无权查看该作品');
    const artifact = owned.find(item => item.id === focusWork?.artifactRef);
    const versions = artifact ? await this.works.listVersions(actor, artifact.id) : [];
    const task = artifact?.projectId ? await this.currentTask(childId, artifact.projectId) : null;
    const evidence = artifact?.projectId && this.evidence ? await this.evidence.read(artifact.projectId) : null;
    return {
      childId, works, focusWork: focusWork ?? null, dataSource: 'live',
      focusGrowth: artifact ? {
        independently: evidence?.independent.slice(0, 5).map(item => item.label) ?? [],
        withAiHelp: evidence?.aiHelped.slice(0, 5).map(item => item.label) ?? [],
        nextPlan: task?.next ? [task.next] : [],
      } : null,
      // Version titles/notes/files may contain private source text; expose receipt metadata only.
      focusVersions: versions.map(version => ({ id: version.id, at: version.createdAt, title: `作品版本 V${version.ordinal}`, note: '已保存这一版，可以回看修改过程。' })),
    };
  }

  async messages(actor: CurrentUser, childId: string): Promise<ParentMessagesPageData> {
    await this.authorize(actor, childId);
    const [page, tickets, receipts] = await Promise.all([
      this.parentGrowth(childId), this.feedback.listForParent(actor.id, childId), this.communication.receipts(actor.id, childId),
    ]);
    const messages: ParentMessage[] = page.timeline.items.map(entry => ({
      id: `growth:${entry.id}`, kind: entry.type === 'artifact_published' ? 'artifact' : 'stage_update',
      title: entry.title, summary: entry.summaryParent, occurredAt: entry.occurredAt,
      status: 'unread', projectTitle: entry.projectTitle,
      focus: { headline: entry.title, occurredAt: entry.occurredAt, projectTitle: entry.projectTitle,
        whatHappened: entry.summaryParent, whatSystemDid: '对应学习记录已由服务端确认并保存。',
        needParent: false, needParentNote: '可以邀请孩子分享探究过程。', howYouCanHelp: '听听孩子如何用观察和证据解释自己的想法。',
        timeline: [{ label: '学习记录已保存', at: entry.occurredAt, state: 'done' }] },
    }));
    for (const ticket of tickets) {
      const last = ticket.entries[ticket.entries.length - 1];
      messages.push({ id: `feedback:${ticket.id}:${last?.id ?? 'submitted'}`, kind: ticket.status === 'resolved' ? 'resolved' : 'feedback_processing',
        title: ticket.status === 'replied' ? '班主任已回复您的反馈' : ticket.status === 'resolved' ? '反馈已确认解决' : '反馈正在处理中',
        summary: ticket.status === 'replied' ? '请在反馈工单中查看回复，并确认问题是否解决。' : '可以在反馈工单中查看处理进展。',
        occurredAt: ticket.updatedAt, status: ticket.status === 'resolved' ? 'resolved' : ticket.status === 'replied' ? 'pending_confirm' : 'processing',
        projectTitle: ticket.projectTitle, focus: null });
    }
    for (const message of messages) {
      const receipt = receipts.find(row => row.messageId === message.id);
      if (receipt && message.status !== 'resolved') message.status = receipt.action === 'read' ? 'read' : 'muted';
    }
    messages.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    return { childId, messages, messagesAvailable: true, dataSource: 'live',
      summary: { total: messages.length, pendingConfirm: messages.filter(row => row.status === 'pending_confirm').length,
        processing: messages.filter(row => row.status === 'processing').length, resolved: messages.filter(row => row.status === 'resolved').length },
      tickets: tickets.map(ticket => ({ id: ticket.id, problem: ticket.problem, projectTitle: ticket.projectTitle,
        owner: ticket.owner ?? '班主任', status: ticket.status === 'resolved' ? 'resolved' : 'processing', handledIn: ticket.handledIn })),
    };
  }

  private async currentTask(childId: string, projectId: string) {
    const plans = await this.plans.listPlansByStudent(childId);
    const plan = plans.filter(row => row.projectId === projectId && row.confirmedAt).sort((a, b) => b.version - a.version)[0];
    if (!plan) return null;
    const [sessions, completions] = await Promise.all([this.plans.listSessions(plan.id), this.plans.listSessionCompletions(plan.id, plan.version)]);
    const done = new Set(completions.map(row => row.learningSessionId));
    const sorted = [...sessions].sort((a, b) => a.index - b.index);
    const label = (session: typeof sorted[number]) => session.title ?? `第 ${session.index} 课时`;
    const next = sorted.find(session => !done.has(session.id));
    const last = [...sorted].reverse().find(session => done.has(session.id));
    return { next: next ? label(next) : null, last: last ? label(last) : null };
  }
  private parentGrowth(childId: string) {
    return this.growth.getParentPage(childId, { type: 'all', projectId: null, from: null, to: null, cursor: null, limit: 100 });
  }
  private async authorize(actor: CurrentUser, childId: string) {
    if (actor.role !== 'parent' || !(await this.directory.childrenOfParent(actor.id)).some(child => child.userId === childId)) {
      throw new ForbiddenException('无权查看该孩子的数据');
    }
    const student = await this.directory.findUser(childId);
    if (!student) throw new ForbiddenException('无权查看该孩子的数据');
    await this.audit?.write({ actorId: actor.id, actorRole: actor.role, action: 'parent.learning.read',
      targetType: 'student', targetId: childId, detail: { projection: 'family-learning.v1', outcome: 'allowed' } });
    return student;
  }
}
function trend(current: number, previous: number): 'up' | 'down' | 'flat' { return current > previous ? 'up' : current < previous ? 'down' : 'flat'; }
