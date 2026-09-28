'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@qitu/auth';
import { Button, EmptyState, ErrorState, Field, IconButton, OfflineBanner, PermissionDenied } from '@qitu/ui';
import { parentApi, ParentOfflineError, ParentPermissionError, type ChildRef } from './parentApi';
import {
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_CONTENT_MIN,
  FEEDBACK_TYPES,
  FeedbackSubmitError,
  clearAllFeedbackDrafts,
  clearFeedbackDraft,
  createEmptyFeedbackDraft,
  createFeedbackIdempotencyKey,
  feedbackSourceFor,
  readFeedbackDraft,
  saveFeedbackDraft,
  submitParentFeedback,
  type FeedbackDraft,
  type FeedbackFailureKind,
  type FeedbackType,
} from './feedback';

/**
 * 全局「联系班主任 / 意见反馈」轻量浮窗（默认收起，固定在右下角）。
 *
 * 与消息页、首页共用 `features/feedback` 的同一套提交服务，服务端只有一条工单链路。
 * 约束（继承 AGENTS.md 与产品文档）：
 *  - 不做家长 AI 对话、不接 Provider / API Key、不新建一套客服系统；
 *  - 反馈必须绑定到一个**有效孩子**，可选关联一个项目；
 *  - 提交中禁用表单，成功后展示工单编号，网络失败保留本机草稿（复用同一幂等键），
 *    退出登录时清空草稿；
 *  - 附件能力尚未接入（`services/api` 无 presign 端点），此处只做**禁用占位**并说明，
 *    既不假装上传成功，也不静默丢弃用户选择。
 */

type PanelState = 'loading' | 'ready' | 'empty' | 'error' | 'offline' | 'permission';
type SubmitState = 'idle' | 'submitting' | 'success' | FeedbackFailureKind;

interface ProjectOption {
  projectId: string;
  title: string;
}

export function ParentFeedbackWidget() {
  const user = useCurrentUser();
  const parentId = user?.id ?? '';

  const [open, setOpen] = useState(false);
  const [panelState, setPanelState] = useState<PanelState>('loading');
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsState, setProjectsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [draft, setDraft] = useState<FeedbackDraft>(() => createEmptyFeedbackDraft());
  const [hydrated, setHydrated] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const loadedRef = useRef(false);
  const hadUserRef = useRef(false);

  /* ---------- 草稿水合与暂存 ---------- */

  useEffect(() => {
    if (!parentId || hydrated) return;
    const stored = readFeedbackDraft(parentId);
    if (stored) setDraft(stored);
    setHydrated(true);
  }, [parentId, hydrated]);

  useEffect(() => {
    if (!parentId || !hydrated) return;
    // 提交成功后已经显式清空草稿，不要在这里把它写回去。
    if (submitState === 'success') return;
    saveFeedbackDraft(parentId, draft);
  }, [parentId, hydrated, draft, submitState]);

  // 退出登录（或会话失效）时清空本机全部草稿：既避免残留未成年人内容，
  // 也避免下一个账号在同一浏览器里读到上一个账号的草稿。
  useEffect(() => {
    if (user) {
      hadUserRef.current = true;
      return;
    }
    if (hadUserRef.current) {
      hadUserRef.current = false;
      clearAllFeedbackDrafts();
    }
  }, [user]);

  /* ---------- 数据加载 ---------- */

  const loadChildren = useCallback(() => {
    setPanelState('loading');
    void parentApi
      .children()
      .then((response) => {
        const list = response.data;
        setChildren(list);
        if (list.length === 0) {
          setPanelState('empty');
          return;
        }
        setDraft((prev) => {
          const preferred =
            prev.childId && list.some((child) => child.childId === prev.childId)
              ? prev.childId
              : list[0]?.childId ?? '';
          return { ...prev, childId: preferred };
        });
        setPanelState('ready');
      })
      .catch((error) => {
        setPanelState(
          error instanceof ParentPermissionError
            ? 'permission'
            : error instanceof ParentOfflineError
              ? 'offline'
              : 'error',
        );
      });
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setSubmitState((prev) => (prev === 'success' ? prev : 'idle'));
    setValidationMessage(null);
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadChildren();
    }
  }, [loadChildren]);

  const closePanel = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // 项目列表只在选定的孩子发生变化时重新拉取；失败不阻塞提交（项目本就是可选）。
  useEffect(() => {
    if (panelState !== 'ready' || !draft.childId) {
      setProjects([]);
      setProjectsState('idle');
      return;
    }
    let active = true;
    setProjectsState('loading');
    void parentApi
      .home(draft.childId)
      .then((response) => {
        if (!active) return;
        const current = response.data.currentProject;
        setProjects(current ? [{ projectId: current.projectId, title: current.title }] : []);
        setProjectsState('ready');
      })
      .catch(() => {
        if (!active) return;
        setProjects([]);
        setProjectsState('error');
      });
    return () => {
      active = false;
    };
  }, [panelState, draft.childId]);

  // 切换孩子后，原先选中的项目可能已不属于该孩子：清空选择，避免把工单挂错孩子。
  useEffect(() => {
    if (draft.projectId && !projects.some((p) => p.projectId === draft.projectId)) {
      setDraft((prev) => (prev.projectId ? { ...prev, projectId: null } : prev));
    }
  }, [projects, draft.projectId]);

  /* ---------- 表单交互 ---------- */

  const submitting = submitState === 'submitting';

  const updateDraft = useCallback((patch: Partial<FeedbackDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSubmitState((prev) => (prev === 'submitting' ? prev : 'idle'));
    setValidationMessage(null);
  }, []);

  const handleSubmit = async () => {
    if (submitting || panelState !== 'ready') return;

    if (!draft.childId) {
      setValidationMessage('请先选择要反馈的孩子。');
      setSubmitState('validation');
      return;
    }
    const content = draft.content.trim();
    if (content.length < FEEDBACK_CONTENT_MIN || content.length > FEEDBACK_CONTENT_MAX) {
      setValidationMessage(
        `反馈内容长度需在 ${FEEDBACK_CONTENT_MIN} 到 ${FEEDBACK_CONTENT_MAX} 字之间。`,
      );
      setSubmitState('validation');
      return;
    }
    if (draft.type === 'project' && !draft.projectId) {
      setValidationMessage('「学习项目相关」需要先选择关联项目。');
      setSubmitState('validation');
      return;
    }

    setValidationMessage(null);
    setSubmitState('submitting');
    try {
      const result = await submitParentFeedback({
        source: feedbackSourceFor(draft.type),
        content,
        childId: draft.childId,
        messageId: null,
        projectId: draft.type === 'project' ? draft.projectId : null,
        // 重试复用草稿里的幂等键，避免响应丢失时重复建单。
        idempotencyKey: draft.idempotencyKey,
      });
      setTicketId(result.ticketId);
      setSubmitState('success');
      if (parentId) clearFeedbackDraft(parentId);
      setDraft((prev) => ({
        ...prev,
        content: '',
        projectId: null,
        idempotencyKey: createFeedbackIdempotencyKey(),
      }));
    } catch (error) {
      const failure =
        error instanceof FeedbackSubmitError
          ? error
          : new FeedbackSubmitError('反馈没能提交，请稍后重试。', 'error');
      setSubmitState(failure.kind);
      setValidationMessage(failure.kind === 'validation' ? failure.message : null);
      // offline / error：草稿与幂等键都留在本机，恢复网络后重试。
    }
  };

  /* ---------- 渲染 ---------- */

  const renderBody = () => {
    if (panelState === 'loading') {
      return (
        <p className="parent-feedback-status" role="status">
          正在加载孩子信息…
        </p>
      );
    }
    if (panelState === 'empty') {
      return (
        <EmptyState
          title="还没有绑定孩子"
          description="绑定孩子之后才能提交反馈，请联系学校确认绑定关系。"
        />
      );
    }
    if (panelState === 'permission') {
      return (
        <PermissionDenied
          title="暂时无法提交反馈"
          description="当前账号没有权限，请联系学校确认绑定关系。"
        />
      );
    }
    if (panelState === 'offline') {
      return (
        <div className="parent-feedback-offline">
          <OfflineBanner readOnly={false} onRetry={loadChildren} />
        </div>
      );
    }
    if (panelState === 'error') {
      return (
        <ErrorState
          title="暂时无法加载"
          description="服务暂时不可用，请稍后重试。"
          onRetry={loadChildren}
        />
      );
    }

    const contentLength = draft.content.trim().length;
    const projectHint =
      projectsState === 'error'
        ? '项目列表加载失败，可稍后重试或先不关联项目。'
        : projects.length === 0
          ? '孩子当前没有进行中的项目，可暂不关联。'
          : '可选：把反馈关联到某个学习项目，便于老师定位。';

    return (
      <form
        className="parent-feedback-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="parent-feedback-grid">
          <Field label="反馈类型" required>
            <select
              value={draft.type}
              disabled={submitting}
              autoFocus
              onChange={(event) => updateDraft({ type: event.target.value as FeedbackType })}
            >
              {FEEDBACK_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="有效孩子" required>
            <select
              value={draft.childId}
              disabled={submitting || children.length <= 1}
              onChange={(event) => updateDraft({ childId: event.target.value, projectId: null })}
            >
              {children.map((child) => (
                <option key={child.childId} value={child.childId}>
                  {child.displayName}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="关联项目" hint={projectHint}>
          <select
            value={draft.projectId ?? ''}
            disabled={submitting || projectsState === 'loading'}
            onChange={(event) => updateDraft({ projectId: event.target.value || null })}
          >
            <option value="">不关联项目</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.title}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="反馈内容"
          required
          error={submitState === 'validation' ? validationMessage : undefined}
          hint={`${contentLength}/${FEEDBACK_CONTENT_MAX}`}
        >
          <textarea
            value={draft.content}
            disabled={submitting}
            maxLength={FEEDBACK_CONTENT_MAX}
            rows={4}
            placeholder="请描述您想反馈的问题或建议（1-500 字）…"
            onChange={(event) => updateDraft({ content: event.target.value })}
          />
        </Field>

        <Field
          label="附件"
          hint="附件上传能力尚未接入，暂不支持添加附件；如需提供文件，请在反馈内容中说明。"
        >
          <input type="file" disabled aria-disabled="true" />
        </Field>

        <div className="parent-feedback-actions">
          <small>{contentLength}/{FEEDBACK_CONTENT_MAX}</small>
          <div className="parent-feedback-action-buttons">
            <Button variant="ghost" onClick={closePanel} disabled={submitting}>
              收起
            </Button>
            <Button
              type="submit"
              loading={submitting}
              disabled={submitting || contentLength === 0}
            >
              提交反馈
            </Button>
          </div>
        </div>

        {submitState === 'success' ? (
          <p className="parent-feedback-success" role="status">
            反馈已提交，工单编号 <strong>{ticketId}</strong>。服务团队会尽快跟进。
          </p>
        ) : null}
        {submitState === 'offline' ? (
          <p className="parent-feedback-error" role="alert">
            网络不可用，反馈尚未提交。草稿已暂存在本机，恢复网络后可重试。
          </p>
        ) : null}
        {submitState === 'permission' ? (
          <p className="parent-feedback-error" role="alert">
            当前账号没有提交反馈的权限，如有疑问请联系学校。
          </p>
        ) : null}
        {submitState === 'error' ? (
          <p className="parent-feedback-error" role="alert">
            反馈没能提交，请稍后重试。草稿已暂存在本机。
          </p>
        ) : null}
      </form>
    );
  };

  return (
    <div className="parent-feedback" data-open={open ? 'true' : undefined}>
      {open ? (
        <section
          id="parent-feedback-panel"
          className="parent-feedback-panel"
          role="dialog"
          aria-label="联系班主任与意见反馈"
        >
          <header className="parent-feedback-head">
            <div>
              <h2>联系班主任 / 意见反馈</h2>
              <p>提交后会生成服务工单，由服务团队跟进。</p>
            </div>
            <IconButton label="收起反馈窗口" onClick={closePanel}>
              <span aria-hidden="true">×</span>
            </IconButton>
          </header>
          <div className="parent-feedback-body">{renderBody()}</div>
        </section>
      ) : null}

      <button
        type="button"
        className="parent-feedback-toggle"
        aria-expanded={open}
        aria-controls="parent-feedback-panel"
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <span aria-hidden="true">✎</span>
        <span>联系班主任</span>
      </button>
    </div>
  );
}
