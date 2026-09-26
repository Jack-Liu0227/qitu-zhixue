'use client';

import type { GrowthProjectOption, StudentGrowthFilterType } from '../types';

/**
 * Client island: type / project filters. It only calls `onChange`; the page
 * owns the query and the data fetch. No growth state is written here.
 */
export interface GrowthFilterState {
  type: StudentGrowthFilterType;
  projectId: string | null;
}

const TYPE_OPTIONS: { value: StudentGrowthFilterType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'project_stage_completed', label: '项目里程碑' },
  { value: 'artifact_published', label: '作品成果' },
  { value: 'reflection_created', label: '我的反思' },
  { value: 'objective_mastered', label: '掌握的目标' },
];

export function FilterBar({
  active,
  projects,
  onChange,
  disabled = false,
}: {
  active: GrowthFilterState;
  projects: GrowthProjectOption[];
  onChange: (next: Partial<GrowthFilterState>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="qitu-growth-filter-bar" role="group" aria-label="成长记录筛选">
      <div className="qitu-growth-filter-types">
        {TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              option.value === active.type
                ? 'qitu-filter-chip is-active'
                : 'qitu-filter-chip'
            }
            aria-pressed={option.value === active.type}
            disabled={disabled}
            onClick={() => onChange({ type: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {projects.length > 0 ? (
        <label className="qitu-growth-filter-project">
          <span className="qitu-growth-filter-label">项目</span>
          <select
            value={active.projectId ?? ''}
            disabled={disabled}
            onChange={(event) =>
              onChange({ projectId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
