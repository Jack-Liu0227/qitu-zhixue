'use client';

import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';

import { inspirationDataSource } from '../data';
import type { InspirationDataSource } from '../data';
import { useInspirationData } from '../hooks/useInspirationData';
import { TemplateCard } from './TemplateCard';

export interface RecommendedTemplatesProps {
  /** Injectable data source; defaults to the module's swappable binding. */
  dataSource?: InspirationDataSource;
}

/**
 * 「推荐项目」面板：模板列表 + 五态（loading / empty / error / 断网 / 权限失败）。
 * 列表只读，点击卡片进入探索确认流程，不创建正式项目。
 */
export function RecommendedTemplates({
  dataSource = inspirationDataSource,
}: RecommendedTemplatesProps) {
  const { state, offline, templates, errorCode, retrying, retry } = useInspirationData(dataSource);

  return (
    <div className="qitu-inspiration-recommended">
      {offline ? <OfflineBanner readOnly onRetry={retry} /> : null}

      {state === 'loading' ? (
        <div className="qitu-inspiration-grid" aria-busy="true" aria-live="polite">
          <SkeletonBlock lines={7} height={16} />
          <SkeletonBlock lines={7} height={16} />
        </div>
      ) : null}

      {state === 'permission-denied' ? (
        <PermissionDenied
          title="无法访问灵感空间"
          description="当前账号没有查看该学生推荐项目的权限。如有疑问请联系班主任。"
        />
      ) : null}

      {state === 'error' ? (
        <ErrorState
          title="推荐项目加载失败"
          description="请稍后重试，自由探索仍可使用。"
          errorCode={errorCode ?? undefined}
          onRetry={retry}
          retrying={retrying}
        />
      ) : null}

      {state === 'offline' && templates.length === 0 ? (
        <ErrorState
          title="当前处于离线状态"
          description="网络恢复后会自动刷新。"
          onRetry={retry}
          retrying={retrying}
        />
      ) : null}

      {state === 'empty' ? (
        <EmptyState
          title="暂时没有推荐项目"
          description="推荐项目正在准备中，你可以先从自由探索开始。"
        />
      ) : null}

      {(state === 'ready' || state === 'offline') && templates.length > 0 ? (
        <div className="qitu-inspiration-grid">
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} readOnly={offline} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
