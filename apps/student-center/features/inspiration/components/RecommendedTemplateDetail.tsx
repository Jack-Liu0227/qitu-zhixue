'use client';

import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock, TagChips } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { inspirationDataSource } from '../data';
import { useInspirationData } from '../hooks/useInspirationData';
import { RecommendedExplorationButton } from './RecommendedExplorationButton';
import { templateMetaLine } from './TemplateCard';

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
  if (state === 'offline' && template === undefined) {
    return (
      <div className="qitu-inspiration-detail">
        <OfflineBanner readOnly onRetry={retry} />
        <EmptyState title="当前无法加载推荐项目" description="恢复网络后重试，暂不会创建推荐探索。" />
      </div>
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
            <p className="qitu-inspiration-template-meta">{templateMetaLine(template)}</p>
          </div>
        </header>
        <p className="qitu-inspiration-detail-summary">{template.summary}</p>
        <TagChips tags={template.tags} />
        {template.lessonCount !== null ? (
          <section aria-labelledby="recommended-lessons-title">
            <h2 id="recommended-lessons-title">课时安排</h2>
            <p>共 {template.lessonCount} 课时{template.lessonMinutes ? ` · 每课时 ${template.lessonMinutes} 分钟` : ''}。</p>
          </section>
        ) : null}
        {template.outcome ? (
          <section aria-labelledby="recommended-outcome-title">
            <h2 id="recommended-outcome-title">预期成果</h2>
            <p>{template.outcome}</p>
          </section>
        ) : null}
        <p className="qitu-inspiration-detail-note">
          这是推荐项目方向。确认意图后，系统才会由 Projects 服务创建正式项目；自由探索请从灵感空间的自由探索入口进入 AI搭档。
        </p>
        <RecommendedExplorationButton template={template} disabled={offline} className="qitu-button qitu-button-primary" />
      </article>
    </div>
  );
}
