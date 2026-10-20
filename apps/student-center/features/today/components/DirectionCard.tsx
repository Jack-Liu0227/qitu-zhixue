import { colors } from '@qitu/design-tokens';
import { VisualAsset } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

import type { IdeaDirection } from '../types';

/**
 * Module-local direction card. `@qitu/ui` does not export `DirectionCard` yet
 * (Wave 3 unavailable list), so the same-name/same-responsibility component is
 * written here. Wave 4 may lift it into the shared kit.
 */
export function DirectionCard({ direction }: { direction: IdeaDirection }) {
  return (
    <StudentLink
      href={direction.href}
      className="qitu-direction-card"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: '#FFFFFF',
        textDecoration: 'none',
        color: colors.text,
      }}
    >
      {direction.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={direction.coverUrl}
          alt=""
          width={48}
          height={48}
          style={{ borderRadius: 10, objectFit: 'cover' }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: colors.page,
            border: `1px solid ${colors.border}`,
            display: 'grid',
            placeItems: 'center',
            color: colors.primary,
            fontWeight: 600,
          }}
        >
          <VisualAsset assetId={direction.iconAssetId ?? 'subject-interdisciplinary-v1'} size={48} />
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <strong style={{ color: colors.heading }}>{direction.title}</strong>
        {direction.subtitle ? (
          <span style={{ color: colors.muted, fontSize: 13 }}>{direction.subtitle}</span>
        ) : null}
      </span>
    </StudentLink>
  );
}
