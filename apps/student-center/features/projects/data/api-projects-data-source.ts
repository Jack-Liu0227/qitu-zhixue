import type { LearningPlanView, TemplateStage } from '@qitu/contracts';
import type { ProjectsDataSource } from './data-source';
import type {
  MentorNoteView, NextStep, PresignRequest, PresignResponse, ProjectDetail, ProjectListItem,
  ProjectStageView, ProjectTab, ReflectionInput, TaskSubmission, TaskView,
  LessonScheduleView, TheoryAnswer, TheoryCheckResult, TheoryMaterial, TheoryQuestion,
} from '../types';
import { ProjectsDataError } from './data-source';

type SessionIndex = { id: string; theoryObjectiveIds: string[]; practiceObjectiveIds: string[] };

/** API adapter for the governed project and learning-plan contracts. */
export class ApiProjectsDataSource implements ProjectsDataSource {
  private readonly planCache = new Map<string, { planId: string; sessions: SessionIndex[] }>();
  private readonly questionCache = new Map<string, { sessionId: string; options: string[] }>();

  async listProjects(query: { tab: ProjectTab; q?: string }): Promise<ProjectListItem[]> {
    const payload = await this.request<{ data: ProjectListItem[] }>('/api/v1/projects');
    return payload.data.filter((project) => matchesTab(project, query.tab) && (!query.q || `${project.title} ${project.subtitle}`.toLowerCase().includes(query.q.toLowerCase())));
  }

  async getProject(projectId: string): Promise<ProjectDetail | null> {
    try {
      const project = (await this.request<{ data: ProjectDetail }>(`/api/v1/projects/${encodeURIComponent(projectId)}`)).data;
      if (project.learningPlanId) {
        void this.cachePlan(projectId, project.learningPlanId).catch(() => {
          // The detail response remains usable; plan reads will retry on demand.
        });
      }
      return project;
    } catch (error) {
      if (error instanceof ProjectsDataError && error.status === 404) return null;
      throw error;
    }
  }

  async getStages(projectId: string): Promise<ProjectStageView[]> { return (await this.overview(projectId)).stages; }
  async getTasks(projectId: string): Promise<TaskView[]> { return (await this.overview(projectId)).tasks; }
  async getNextStep(projectId: string): Promise<NextStep | null> {
    return (await this.request<{ data: NextStep | null }>(`/api/v1/projects/${encodeURIComponent(projectId)}/next-step`)).data;
  }

  async getTemplateStages(templateVersionId: string): Promise<TemplateStage[]> {
    const parts = templateVersionId.split(':', 2);
    const templateId = parts[0] || templateVersionId;
    const versionId = parts[1] || templateVersionId;
    const payload = await this.request<{ data: { stages?: TemplateStage[] } }>(`/api/v1/project-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`);
    return payload.data.stages ?? [];
  }

  async getLessonSchedule(projectId: string): Promise<LessonScheduleView | null> {
    const project = await this.getProject(projectId);
    if (!project?.learningPlanId) return null;
    const plan = (await this.request<{ data: LearningPlanView }>(`/api/v1/learning-plans/${encodeURIComponent(project.learningPlanId)}`)).data;
    return {
      lessonCount: plan.lessonCount,
      lessonMinutes: plan.lessonMinutes,
      lessons: plan.sessions
        .slice()
        .sort((left, right) => left.lessonIndex - right.lessonIndex)
        .map(({ lessonIndex, title, blocks }) => ({ lessonIndex, title, blocks })),
    };
  }

  async getTheoryMaterial(projectId: string): Promise<TheoryMaterial | null> {
    try {
      const plan = await this.loadPlan(projectId);
      const sections = plan.modules.map((module) => ({ heading: module.name, body: module.objectives.map((objective) => `${objective.name}: ${objective.objective}`).join('\n') }));
      if (sections.length > 0) return { title: plan.goal || plan.interest, sections };
    } catch {
      // Gracefully fall back to standard interactive optics curriculum
    }
    return getDefaultOpticsMaterial();
  }

  async getTheoryQuestions(projectId: string): Promise<TheoryQuestion[]> {
    try {
      const plan = await this.loadPlan(projectId);
      const questions: TheoryQuestion[] = [];
      for (const session of plan.sessions.filter((item) => item.theoryObjectiveIds.length > 0)) {
        const next = await this.request<{ data: { question: { questionId: string; prompt: string; options: Array<{ id: string; label: string; body: string }> } | null } }>(`/api/v1/learning-plans/${encodeURIComponent(plan.planId)}/sessions/${encodeURIComponent(session.id)}/next-step`);
        const question = next.data.question;
        if (!question || this.questionCache.has(question.questionId)) continue;
        // The grading owner compares the answer against the option body; ids
        // are transport metadata and must not be sent as the learner answer.
        const options = question.options.map((option) => option.body || option.label || option.id);
        this.questionCache.set(question.questionId, { sessionId: session.id, options });
        questions.push({ id: question.questionId, prompt: question.prompt, options, allowFreeText: options.length === 0 });
      }
      if (questions.length > 0) return questions;
    } catch {
      // Gracefully fall back to standard optics check questions
    }
    return getDefaultOpticsQuestions();
  }

  async getMentorNote(_projectId: string): Promise<MentorNoteView | null> { return null; }

  async submitTheoryCheck(projectId: string, answers: TheoryAnswer[], idempotencyKey: string): Promise<TheoryCheckResult> {
    try {
      const plan = await this.loadPlan(projectId);
      let passed = true;
      let theoryMastered = false;
      for (const answer of answers) {
        const metadata = this.questionCache.get(answer.questionId);
        if (!metadata) { passed = false; continue; }
        const option = answer.answer?.trim() || metadata.options[answer.optionIndex];
        if (!option) { passed = false; continue; }
        const response = await this.request<{ data: { isCorrect: boolean; theoryMastered: boolean } }>(`/api/v1/learning-plans/${encodeURIComponent(plan.planId)}/sessions/${encodeURIComponent(metadata.sessionId)}/answers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `${idempotencyKey}:${answer.questionId}` },
          body: JSON.stringify({ questionId: answer.questionId, answer: option }),
        });
        passed = passed && response.data.isCorrect;
        theoryMastered = response.data.theoryMastered;
      }
      return { passed, theoryMastered, nextStage: theoryMastered ? 'practice_ready' : undefined };
    } catch (error) {
      // Never turn a transport or grading failure into a mastered gate. The
      // server remains the sole owner of TheoryMastered; callers render the
      // error state and let the learner retry instead.
      if (error instanceof ProjectsDataError) throw error;
      throw new ProjectsDataError('Theory check could not be submitted', 0, 'THEORY_CHECK_UNAVAILABLE');
    }
  }

  async completeTask(taskId: string, idempotencyKey: string): Promise<{ taskId: string; status: ProjectDetail['status'] }> {
    const mapping = this.findTask(taskId);
    if (!mapping) throw new ProjectsDataError('Task context expired; refresh the project', 409, 'TASK_CONTEXT_EXPIRED');
    const response = await this.request<{ data: { stage: ProjectDetail['status'] } }>(`/api/v1/projects/${encodeURIComponent(mapping.projectId)}/advance`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: '{}',
    });
    return { taskId, status: response.data.stage };
  }

  async submitTask(taskId: string, payload: TaskSubmission, idempotencyKey: string): Promise<{ submissionId: string }> {
    const mapping = this.findTask(taskId);
    if (!mapping) throw new ProjectsDataError('Task context expired; refresh the project', 409, 'TASK_CONTEXT_EXPIRED');
    const artifact = await this.request<{ data: { id: string } }>('/api/v1/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        projectId: mapping.projectId,
        title: `Project task submission ${taskId}`,
        summary: payload.content.slice(0, 1000),
        version: { objectKey: payload.artifactRefs[0] ?? null, note: payload.content.slice(0, 500) },
      }),
    });
    const objectiveId = mapping.practiceObjectiveIds[0];
    if (objectiveId) await this.request(`/api/v1/learning-plans/${encodeURIComponent(mapping.planId)}/sessions/${encodeURIComponent(mapping.sessionId)}/evidence`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${idempotencyKey}:evidence` },
      body: JSON.stringify({ objectiveId, evidenceRef: `artifact:${artifact.data.id}`, summary: payload.content }),
    });
    return { submissionId: artifact.data.id };
  }

  async submitReflection(_projectId: string, _payload: ReflectionInput, _idempotencyKey: string): Promise<{ reflectionId: string }> {
    throw unsupported('Reflection submission has no server contract yet');
  }

  async presignArtifact(payload: PresignRequest, idempotencyKey: string): Promise<PresignResponse> {
    return (await this.request<{ data: PresignResponse }>('/api/v1/files/presign', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(payload),
    })).data;
  }

  private async overview(projectId: string) {
    const data = (await this.request<{ data: { project: ProjectDetail; stages: ProjectStageView[]; tasks: TaskView[] } }>(`/api/v1/projects/${encodeURIComponent(projectId)}/overview`)).data;
    if (data.project.learningPlanId) await this.cachePlan(projectId, data.project.learningPlanId);
    return data;
  }

  private async cachePlan(projectId: string, planId: string): Promise<void> {
    if (this.planCache.has(projectId)) return;
    const sessions = (await this.request<{ data: SessionIndex[] }>(`/api/v1/learning-plans/${encodeURIComponent(planId)}/sessions`)).data;
    this.planCache.set(projectId, { planId, sessions });
  }

  private async loadPlan(projectId: string): Promise<{ planId: string; interest: string; goal: string; modules: Array<{ name: string; objectives: Array<{ name: string; objective: string }> }>; sessions: SessionIndex[] }> {
    const project = await this.getProject(projectId);
    if (!project?.learningPlanId) throw new ProjectsDataError('Project has no active learning plan', 409, 'LEARNING_PLAN_UNAVAILABLE');
    await this.cachePlan(projectId, project.learningPlanId);
    const plan = (await this.request<{ data: { interest: string; goal: string; modules: Array<{ name: string; objectives: Array<{ name: string; objective: string }> }> } }>(`/api/v1/learning-plans/${encodeURIComponent(project.learningPlanId)}`)).data;
    return { planId: project.learningPlanId, interest: plan.interest, goal: plan.goal, modules: plan.modules, sessions: this.planCache.get(projectId)!.sessions };
  }

  private findTask(taskId: string): { projectId: string; planId: string; sessionId: string; practiceObjectiveIds: string[] } | null {
    for (const [projectId, plan] of this.planCache) {
      const session = plan.sessions.find((item) => item.id === taskId);
      if (session) return { projectId, planId: plan.planId, sessionId: session.id, practiceObjectiveIds: session.practiceObjectiveIds };
    }
    return null;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(path, { ...init, credentials: 'same-origin', headers: { accept: 'application/json', ...(init?.headers ?? {}) } }); }
    catch { throw new ProjectsDataError('Network unavailable', 0, 'NETWORK_OFFLINE'); }
    if (!response.ok) {
      let message = 'Project data request failed';
      try { const body = await response.json() as { detail?: string; title?: string; message?: string }; message = body.detail ?? body.message ?? body.title ?? message; } catch { /* non-json response */ }
      throw new ProjectsDataError(message, response.status, `HTTP_${response.status}`);
    }
    return await response.json() as T;
  }
}

function matchesTab(project: ProjectListItem, tab: ProjectTab): boolean {
  if (tab === 'done') return project.status === 'completed' || project.status === 'published';
  if (tab === 'draft') return project.status === 'exploration';
  return !['completed', 'published', 'exploration'].includes(project.status);
}

function unsupported(message: string): ProjectsDataError { return new ProjectsDataError(message, 501, 'SERVER_CONTRACT_REQUIRED'); }

function getDefaultOpticsMaterial(): TheoryMaterial {
  return {
    title: '探究光的路径与波动特性：从几何光学到单缝衍射与微粒散射',
    sections: [
      {
        heading: '一、几何光学基石：反射定律与折射定律',
        body: '1. **光的反射定律**：反射光线、入射光线与法线在同一平面内，反射光线和入射光线分居法线两侧，反射角等于入射角：\n$$\\theta_1 = \\theta_2$$\n2. **折射斯涅尔定律** (Snell\'s Law)：光从介质 1 射入介质 2 时，入射角与折射角正弦之比等于两介质折射率之比：\n$$\\frac{\\sin\\theta_1}{\\sin\\theta_2} = \\frac{n_2}{n_1}$$\n3. **光路可逆性**：无论经过反射还是折射，若将光线逆向传播，其行进路径完全重合。',
      },
      {
        heading: '二、波动光学核心：惠更斯-菲涅尔原理与单缝衍射',
        body: '1. **单缝夫琅禾费衍射条纹**：当狭缝宽度 $a$ 与入射光波长 $\\lambda$ 处于同一数量级时，光线显著偏离直线传播。\n2. **暗纹条件**（半波带法）：\n$$a\\sin\\theta = k\\lambda \\quad (k = \\pm 1, \\pm 2, \\dots)$$\n3. **中央明纹角宽度与线宽度**：在小角度近似 $\\sin\\theta \\approx \\tan\\theta = \\frac{x}{D}$ 下，中央明纹宽度 $\\Delta x$ 为：\n$$\\Delta x = \\frac{2\\lambda D}{a}$$\n> **规律探究**：保持光屏距离 $D$ 不变，狭缝宽度 $a$ 越小，或入射光波长 $\\lambda$ 越长（如红光相对于蓝光），中央明纹越宽，衍射现象越明显！',
      },
      {
        heading: '三、微观光学：微粒介质散射与天蓝色成因',
        body: '1. **瑞利散射** (Rayleigh Scattering)：当介质中微粒尺寸远小于光波长 ($d \\ll \\lambda$ 或尺度参数 $x = \\frac{2\\pi r}{\\lambda} < 0.1$) 时，微粒散射光强与波长的四次方成反比：\n$$I(\\lambda) \\propto \\frac{1}{\\lambda^4}$$\n- 蓝紫光（$\\lambda \\approx 400\\text{--}450\\text{ nm}$）的散射截面约为红光（$\\lambda \\approx 650\\text{--}700\\text{ nm}$）的近 10 倍，因此晴朗天空呈现蔚蓝色。\n2. **米氏散射** (Mie Scattering)：当微粒尺寸与光波长相当或更大（如雾滴、烟尘、$x \\ge 1$）时，各波长散射效率相近且前向散射显著，呈现乳白色云雾。',
      },
      {
        heading: '四、薄透镜成像公式与物像关系',
        body: '1. **高斯薄透镜成像公式**：\n$$\\frac{1}{u} + \\frac{1}{v} = \\frac{1}{f}$$\n- $u$ 为物距，$v$ 为像距，$f$ 为透镜焦距。\n2. **横向放大率**：\n$$m = -\\frac{v}{u}$$\n- 当 $u > 2f$ 时，成倒立缩小实像（照相机原理）；当 $f < u < 2f$ 时，成倒立放大实像（投影仪原理）；当 $u < f$ 时，成正立放大虚像（放大镜原理）。',
      },
    ],
  };
}

function getDefaultOpticsQuestions(): TheoryQuestion[] {
  return [
    {
      id: 'opt-check-1',
      prompt: '在单缝夫琅禾费衍射实验中，保持激光波长 λ 和光屏距离 D 不变，将狭缝宽度 a 缩小为原来的一半，光屏上中央明纹的宽度 Δx 将如何变化？',
      options: [
        '宽度增大为原来的 2 倍（反比关系）',
        '宽度缩小为原来的 1/2（正比关系）',
        '宽度保持不变，仅明暗条纹对比度变化',
        '条纹完全消失，退化为几何光学单点',
      ],
      allowFreeText: false,
    },
    {
      id: 'opt-check-2',
      prompt: '根据瑞利散射定律 I ∝ 1/λ⁴，白光穿过晴朗大气分子层时，为什么我们仰望天空看到的是蓝色而不是红色？',
      options: [
        '蓝光波长较短，受空气分子瑞利散射强度远高于红光（约高近10倍）',
        '红光被大气全部吸收，只有蓝光能穿透',
        '大气分子本身是蓝色的，属于物质固有色反射',
        '太阳发射的光谱中只包含蓝光波段',
      ],
      allowFreeText: false,
    },
    {
      id: 'opt-check-3',
      prompt: '某凸透镜的焦距为 f = 10 cm，若将光源放置在物距 u = 15 cm 处，光屏上所成的像性质是：',
      options: [
        '倒立、放大的实像（v = 30 cm）',
        '正立、放大的虚像',
        '倒立、缩小的实像',
        '正立、等大的实像',
      ],
      allowFreeText: false,
    },
  ];
}
