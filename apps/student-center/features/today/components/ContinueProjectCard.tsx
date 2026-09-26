import { colors } from '@qitu/design-tokens';
import { ProgressBar, SectionCard } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

import type { ActiveProjectSummary } from '../types';
import { StageStepper4 } from './StageStepper4';

/**
 * 「当前项目」card: frozen-template stage strip + server-computed progress.
 * `stageIndex` / `progressPercent` are display-only; the card navigates to the
 * project detail and never writes project state.
 */
export function ContinueProjectCard({ project }: { project: ActiveProjectSummary | null }) {
  if (!project) return null;

  return (
    <SectionCard
      title="当前项目"
      action={
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <StudentLink href={`/student/projects/${project.id}`}>查看详情</StudentLink>
          <StudentLink href="/student/growth">成长轨迹</StudentLink>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {project.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.coverUrl}
            alt=""
            width={72}
            height={72}
            style={{ borderRadius: 12, objectFit: 'cover' }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 72,
              height: 72,
              borderRadius: 12,
              background: colors.page,
              border: `1px solid ${colors.border}`,
              display: 'grid',
              placeItems: 'center',
              color: colors.primary,
              fontWeight: 600,
            }}
          >
            {project.title.charAt(0)}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, color: colors.heading }}>{project.title}</h3>
          <p style={{ margin: '2px 0 10px', color: colors.muted, fontSize: 13 }}>{project.subtitle}</p>
          <StageStepper4 stages={project.stages} />
          <div style={{ marginTop: 10 }}>
            <ProgressBar percent={project.progressPercent} label={`完成 ${project.progressPercent}%`} />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
