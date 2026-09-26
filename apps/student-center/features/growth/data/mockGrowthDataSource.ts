import type {
  GrowthDataSource,
} from './growthDataSource';
import {
  GrowthOfflineError,
  GrowthPermissionError,
  GrowthDataSourceError,
} from './growthDataSource';
import {
  MOCK_GROWTH_PROJECTS,
  MOCK_GROWTH_RECORDS,
  MOCK_GROWTH_SUMMARY,
  type InternalGrowthRecord,
} from './growthFixtures';
import { projectStudentTimeline } from './projectStudentEntry';
import type {
  GrowthProjectOption,
  StudentGrowthPageData,
  StudentGrowthQuery,
  StudentGrowthSummary,
  StudentGrowthTimeline,
} from '../types';

/**
 * Scenarios a reviewer can select to reach every one of the five required UI
 * states without a backend. Production passes no scenario (defaults to
 * `ready`); the integrator can also swap this whole module for `api.ts`.
 */
export type MockGrowthScenario =
  | 'ready'
  | 'empty'
  | 'loading'
  | 'error'
  | 'offline'
  | 'permission_denied';

/**
 * In-memory last-known page. Deliberately NOT localStorage: the spec allows no
 * minor-data persistence on the client beyond the current session, and this
 * keeps the 断网 state honest (no transcript/draft is ever stored).
 */
let lastKnownPage: StudentGrowthPageData | null = null;

function applyFilters(
  records: readonly InternalGrowthRecord[],
  query: StudentGrowthQuery,
): InternalGrowthRecord[] {
  return records.filter((record) => {
    if (record.type === 'guardian_feedback' || record.type === 'mentor_note') {
      return false;
    }
    if (record.type === 'tutor_record' || record.type === 'escalation_event') {
      return false;
    }
    if (query.type !== 'all' && record.type !== query.type) {
      return false;
    }
    if (query.projectId !== null && record.projectId !== query.projectId) {
      return false;
    }
    if (query.from !== null && record.occurredAt < query.from) {
      return false;
    }
    if (query.to !== null && record.occurredAt > query.to) {
      return false;
    }
    return true;
  });
}

function paginate(
  timeline: StudentGrowthTimeline,
  query: StudentGrowthQuery,
): StudentGrowthTimeline {
  const offset = query.cursor === null ? 0 : Number.parseInt(query.cursor, 10);
  const start = Number.isNaN(offset) ? 0 : offset;
  const limit = query.limit > 0 ? query.limit : 20;
  const items = timeline.items.slice(start, start + limit);
  const nextOffset = start + items.length;
  const hasNext = nextOffset < timeline.items.length;
  return {
    items,
    nextCursor: hasNext ? String(nextOffset) : null,
    hasNext,
  };
}

function buildReadyPage(query: StudentGrowthQuery): StudentGrowthPageData {
  const filtered = applyFilters(MOCK_GROWTH_RECORDS, query);
  const timeline = paginate(projectStudentTimeline(filtered), query);
  return {
    summary: MOCK_GROWTH_SUMMARY,
    timeline,
    projects: MOCK_GROWTH_PROJECTS,
    hasAnyProject: MOCK_GROWTH_PROJECTS.length > 0,
  };
}

function buildEmptyPage(): StudentGrowthPageData {
  return {
    summary: {
      streakDays: 0,
      projectsCompleted: 0,
      objectivesMastered: 0,
      artifactsPublished: 0,
    },
    timeline: { items: [], nextCursor: null, hasNext: false },
    projects: [],
    hasAnyProject: false,
  };
}

/**
 * Creates the swappable mock implementation of `GrowthDataSource`.
 *
 * No method can mutate a growth record, metric, or milestone: the interface
 * exposes reads only, satisfying growth-spec.md §8 / §11.4.
 */
export function createMockGrowthDataSource(
  scenario: MockGrowthScenario = 'ready',
): GrowthDataSource {
  async function loadGrowthPage(query: StudentGrowthQuery): Promise<StudentGrowthPageData> {
    switch (scenario) {
      case 'loading':
        // Never resolves: keeps the `SkeletonBlock` loading state on screen.
        return new Promise<StudentGrowthPageData>(() => {});
      case 'permission_denied':
        throw new GrowthPermissionError();
      case 'offline': {
        if (lastKnownPage === null) {
          lastKnownPage = buildReadyPage(query);
        }
        throw new GrowthOfflineError(lastKnownPage);
      }
      case 'error':
        throw new GrowthDataSourceError('GROWTH_UNAVAILABLE', '成长轨迹加载失败');
      case 'empty': {
        const page = buildEmptyPage();
        lastKnownPage = page;
        return page;
      }
      case 'ready':
      default: {
        const page = buildReadyPage(query);
        lastKnownPage = page;
        return page;
      }
    }
  }

  return {
    loadGrowthPage,
    async getSummary(): Promise<StudentGrowthSummary> {
      const page = await loadGrowthPage({
        type: 'all',
        projectId: null,
        from: null,
        to: null,
        cursor: null,
        limit: 20,
      });
      return page.summary;
    },
    async getTimeline(query: StudentGrowthQuery): Promise<StudentGrowthTimeline> {
      const page = await loadGrowthPage(query);
      return page.timeline;
    },
    async getProjectOptions(): Promise<GrowthProjectOption[]> {
      const page = await loadGrowthPage({
        type: 'all',
        projectId: null,
        from: null,
        to: null,
        cursor: null,
        limit: 20,
      });
      return page.projects;
    },
  };
}

/** Test/reviewer helper: clears the in-memory 断网 cache. */
export function resetGrowthCache(): void {
  lastKnownPage = null;
}
