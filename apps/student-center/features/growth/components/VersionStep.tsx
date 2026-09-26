import type { ReactNode } from 'react';

/**
 * Module-local vertical timeline node (growth-spec.md §10: `@qitu/ui` does not
 * ship `VersionStep`, so the module owns a same-name/same-responsibility
 * component; Wave 4 may lift it into `@qitu/ui`). No state, no writes.
 */
export type VersionStepTone = 'done' | 'current' | 'attention' | 'neutral';

export function VersionStep({
  tone = 'done',
  label,
  meta,
  last = false,
  children,
}: {
  tone?: VersionStepTone;
  label: string;
  meta?: string;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={`qitu-version-step qitu-version-step-${tone}`}>
      <div className="qitu-version-step-rail" aria-hidden="true">
        <span className="qitu-version-step-dot" />
        {last ? null : <span className="qitu-version-step-line" />}
      </div>
      <div className="qitu-version-step-body">
        <div className="qitu-version-step-head">
          <span className="qitu-version-step-label">{label}</span>
          {meta ? <time className="qitu-version-step-meta">{meta}</time> : null}
        </div>
        {children ? <div className="qitu-version-step-content">{children}</div> : null}
      </div>
    </li>
  );
}
