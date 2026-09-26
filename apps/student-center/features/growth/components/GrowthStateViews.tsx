import {
  EmptyState,
  ErrorState,
  HandwrittenNote,
  PermissionDenied,
  RobotMascot,
  SectionCard,
  SkeletonBlock,
} from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

/**
 * The five required states, each rendered with the shared `@qitu/ui` state
 * components (WAVE3-BRIEF §3.1). The page picks one; the data source decides
 * which by resolving, returning empty, or throwing.
 */

export function GrowthLoadingView() {
  return (
    <div className="qitu-growth-loading" aria-busy="true" aria-live="polite">
      <SectionCard title="正在加载你的成长轨迹…">
        <SkeletonBlock lines={1} height={20} width="60%" />
      </SectionCard>
      <SectionCard>
        <SkeletonBlock lines={4} height={18} />
      </SectionCard>
      <SectionCard>
        <SkeletonBlock lines={4} height={18} />
      </SectionCard>
    </div>
  );
}

export function GrowthEmptyView() {
  return (
    <EmptyState
      title="你的成长轨迹会从这里开始"
      description="完成第一个小目标后，里程碑、作品、反思和掌握的目标都会出现在这里。现在，去灵感空间开始第一个项目吧。"
      illustration={
        <div className="qitu-growth-empty-illustration">
          <RobotMascot mood="cheering" size={120} />
          <HandwrittenNote rotate={-4}>第一步也很了不起</HandwrittenNote>
        </div>
      }
      action={
        <StudentLink className="qitu-button qitu-button-primary" href="/student/inspiration">
          去灵感空间看看
        </StudentLink>
      }
    />
  );
}

export function GrowthErrorView({
  description,
  onRetry,
  retrying = false,
}: {
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <ErrorState
      title="成长轨迹没能加载出来"
      description={description ?? '可能是网络或服务临时出了点问题，可以稍后再试。'}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

export function GrowthPermissionView({ onBack }: { onBack?: () => void }) {
  return (
    <PermissionDenied
      title="暂时看不到这份成长轨迹"
      description="这个页面只对本人开放。如果你换了账号，请用学生账号重新登录。"
      onBack={onBack}
    />
  );
}
