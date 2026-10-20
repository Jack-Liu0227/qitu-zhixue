import { colors } from '@qitu/design-tokens';
import { SectionCard, VisualAsset } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

import type { ActiveProjectSummary } from '../types';

/**
 * "Current project" links into the lesson-first detail page. This card never
 * writes project state.
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
            <VisualAsset assetId="subject-interdisciplinary-v1" size={64} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, color: colors.heading }}>{project.title}</h3>
          <p style={{ margin: '2px 0 10px', color: colors.muted, fontSize: 13 }}>{project.subtitle}</p>
        </div>
      </div>
    </SectionCard>
  );
}
