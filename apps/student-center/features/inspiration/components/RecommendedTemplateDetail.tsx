'use client';

import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock, TagChips } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { inspirationDataSource } from '../data';
import { useInspirationData } from '../hooks/useInspirationData';

export function RecommendedTemplateDetail({ templateId }: { templateId: string }) {
  const { state, offline, templates, errorCode, retrying, retry } = useInspirationData(inspirationDataSource);
  const template = templates.find((item) => item.id === templateId);

  if (state === 'loading') {
    return <SkeletonBlock lines={9} height={18} />;
  }
  if (state === 'permission-denied') {
    return <PermissionDenied title="无法访问推荐项目" description="当前账号没有查看该推荐项目的权限。" />;
  }
  if (state === 'error') {
    return (
      <ErrorState
        title="推荐项目加载失败"
        description="请稍后重试。"
        errorCode={errorCode ?? undefined}
        onRetry={retry}
        retrying={retrying}
      />
    );
  }
  if (template === undefined) {
    return <EmptyState title="推荐项目不存在" description="返回灵感空间查看其他推荐方向。" />;
  }

  return (
    <div className="qitu-inspiration-detail">
      {offline ? <OfflineBanner readOnly onRetry={retry} /> : null}
      <StudentLink href="/student/inspiration" className="qitu-button qitu-button-secondary">
        返回推荐项目
      </StudentLink>
      <article className="qitu-inspiration-detail-panel">
        <header className="qitu-inspiration-template-header">
          <span className="qitu-inspiration-template-cover" aria-hidden="true">
            {template.coverEmoji ?? template.title.charAt(0)}
          </span>
          <div className="qitu-inspiration-template-heading">
            <p className="qitu-inspiration-eyebrow">推荐项目</p>
            <h1 className="qitu-inspiration-template-title">{template.title}</h1>
            <p className="qitu-inspiration-template-meta">
              {template.subject} · {template.difficulty} · 约 {template.durationWeeks} 周
            </p>
          </div>
        </header>
        <p className="qitu-inspiration-detail-summary">{template.summary}</p>
        <TagChips tags={template.tags} />
        <section aria-labelledby="recommended-stages-title">
          <h2 id="recommended-stages-title">项目路径</h2>
          <ol className="qitu-inspiration-stages">
            {template.stages.map((stage, index) => (
              <li key={stage.id} className="qitu-inspiration-stage">
                <span className="qitu-inspiration-stage-index" aria-hidden="true">{index + 1}</span>
                <span className="qitu-inspiration-stage-label">{stage.label}</span>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="recommended-outcome-title">
          <h2 id="recommended-outcome-title">预期成果</h2>
          <p>{template.outcome}</p>
        </section>
        <p className="qitu-inspiration-detail-note">
          这是推荐项目方向。确认意图后，系统才会由 Projects 服务创建正式项目；自由探索请从灵感空间的自由探索入口进入 AI搭档。
        </p>
      </article>
    </div>
  );
}
