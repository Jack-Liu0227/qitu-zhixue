import type {
  MasteryCurrentView,
  MasteryHttpResponse,
  MasteryReadCurrentRequest,
  MasteryReadPort,
  MasteryReadRegressionRequest,
  MasteryReadSnapshotRequest,
  MasteryReadThresholdRequest,
  MasteryReadTimelineRequest,
  MasteryRegressionView,
  MasterySnapshot,
  MasteryThresholdView,
  MasteryTimelineView,
} from '@qitu/contracts';

/**
 * 掌握度只读 facade。
 *
 * 设计边界（见 `packages/contracts/src/mastery.ts` 的 `MasteryReadPort`）：
 * - 这里只实现浏览器读端口，`evaluate` / 写事件 / 设置 level 一律不暴露；
 * - 请求体只允许服务端白名单里的过滤字段（studentId 由会话推导，客户端不可传）；
 * - 响应一律是仓库约定的 `{ data: T }`，错误沿用 `ApiError`（由传输层抛出）；
 * - 仅依赖 `fetch` 传输层，不引入 Node / 数据库依赖。
 */

/**
 * facade 依赖的最小传输接口：只取 `createApiClient` 的 `get<T>`。
 *
 * 刻意**不**接收 post/patch，从类型上堵死浏览器写掌握状态的路径。
 */
export interface MasteryTransport {
  get<T>(path: string): Promise<T>;
}

const BASE_PATH = '/api/v1/mastery';

/** 查询串可接受的值类型：只含标量、null/undefined 和只读字符串数组。 */
type QueryValue = string | number | null | undefined | readonly string[];

/**
 * 白名单式查询串构造。
 *
 * 只有显式传入的字段会进入 query；调用方（即使是 JS 调用）塞入
 * `level` / `score` / `studentId` 等字段不会出现在请求里。
 * 数组按逗号拼接（`knowledgePointIds=a,b`）。
 */
function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function getData<T>(transport: MasteryTransport, path: string): Promise<T> {
  const response = await transport.get<MasteryHttpResponse<T>>(path);
  return response.data;
}

/**
 * 用现有 `get<T>` 传输层构造 `MasteryReadPort`。
 *
 * 五个读方法对应：
 * - `GET /api/v1/mastery/current`
 * - `GET /api/v1/mastery/timeline`
 * - `GET /api/v1/mastery/snapshot`
 * - `GET /api/v1/mastery/threshold`
 * - `GET /api/v1/mastery/regressions`
 */
export interface MasteryReadScope {
  studentId?: string;
}

export function createMasteryReadPort(transport: MasteryTransport, scope: MasteryReadScope = {}): MasteryReadPort {
  const studentId = scope.studentId;
  if (studentId !== undefined && (!studentId.trim() || studentId.length > 200)) throw new Error('SDK_SCOPE_INVALID');
  return {
    getCurrent(input: MasteryReadCurrentRequest = {}): Promise<MasteryCurrentView> {
      const query = toQueryString({
        studentId,
        knowledgePointId: input.knowledgePointId,
        courseVersion: input.courseVersion,
        validAt: input.validAt,
        knownAt: input.knownAt,
      });
      return getData<MasteryCurrentView>(transport, `${BASE_PATH}/current${query}`);
    },

    getTimeline(input: MasteryReadTimelineRequest): Promise<MasteryTimelineView> {
      const query = toQueryString({
        studentId,
        knowledgePointId: input.knowledgePointId,
        courseVersion: input.courseVersion,
        validAt: input.validAt,
        knownAt: input.knownAt,
        cursor: input.cursor,
        limit: input.limit,
      });
      return getData<MasteryTimelineView>(transport, `${BASE_PATH}/timeline${query}`);
    },

    getSnapshot(input: MasteryReadSnapshotRequest): Promise<MasterySnapshot> {
      const query = toQueryString({
        studentId,
        validAt: input.validAt,
        knownAt: input.knownAt,
        knowledgePointIds: input.knowledgePointIds,
      });
      return getData<MasterySnapshot>(transport, `${BASE_PATH}/snapshot${query}`);
    },

    getThreshold(input: MasteryReadThresholdRequest): Promise<MasteryThresholdView> {
      const query = toQueryString({
        studentId,
        knowledgePointId: input.knowledgePointId,
        courseVersion: input.courseVersion,
        validAt: input.validAt,
        knownAt: input.knownAt,
      });
      return getData<MasteryThresholdView>(transport, `${BASE_PATH}/threshold${query}`);
    },

    getRegressionAlerts(input: MasteryReadRegressionRequest): Promise<MasteryRegressionView> {
      const query = toQueryString({
        studentId,
        knowledgePointId: input.knowledgePointId,
        since: input.since,
        knownAt: input.knownAt,
        limit: input.limit,
      });
      return getData<MasteryRegressionView>(transport, `${BASE_PATH}/regressions${query}`);
    },
  };
}

/* ------------------------------------------------------------------ *
 * 编译期类型验证（只做类型检查，不产生运行时代码）
 * ------------------------------------------------------------------ */

type AssertTrue<T extends true> = T;

/** facade 必须完整满足只读端口。 */
type _FacadeMatchesReadPort = AssertTrue<
  ReturnType<typeof createMasteryReadPort> extends MasteryReadPort ? true : false
>;

/** 只读端口不得出现任何写方法 / 掌握级别写入入口。 */
type _ReadPortHasNoWrites = AssertTrue<
  'evaluate' extends keyof MasteryReadPort
    ? false
    : 'setLevel' extends keyof MasteryReadPort
      ? false
      : 'writeEvent' extends keyof MasteryReadPort
        ? false
        : true
>;

/** 读请求类型只含过滤字段；服务端拥有的判定字段不得出现。 */
type _ReadRequestsExcludeServerOwnedFields = AssertTrue<
  'level' extends keyof MasteryReadCurrentRequest
    ? false
    : 'score' extends keyof MasteryReadCurrentRequest
      ? false
      : 'qualitativeMastered' extends keyof MasteryReadCurrentRequest
        ? false
        : 'studentId' extends keyof MasteryReadCurrentRequest
          ? false
          : 'level' extends keyof MasteryReadTimelineRequest
            ? false
            : 'score' extends keyof MasteryReadThresholdRequest
              ? false
              : 'level' extends keyof MasteryReadSnapshotRequest
                ? false
                : 'qualitativeMastered' extends keyof MasteryReadRegressionRequest
                  ? false
                  : true
>;

// 保持类型别名被引用（无运行时代价）。
type _MasteryReadFacadeTypeChecks =
  _FacadeMatchesReadPort | _ReadPortHasNoWrites | _ReadRequestsExcludeServerOwnedFields;
