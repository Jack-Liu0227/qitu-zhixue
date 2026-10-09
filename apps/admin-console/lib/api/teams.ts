/**
 * 管理端「团队」API —— 真实接口，无任何静默回退。
 *
 * 对应冻结契约（`@qitu/contracts` team-runtime 写入侧 DTO）：
 *   GET    /api/v1/admin/ai-runtime/teams
 *   POST   /api/v1/admin/ai-runtime/teams
 *   PATCH  /api/v1/admin/ai-runtime/teams/:id
 *
 * 历史版本在这里用 try/catch 静默回退 `THUNDER_FIGHTER_TEAM_CONFIG`，
 * 请求失败也「看起来有数据」。该兜底已按评审要求**彻底删除**：现在请求
 * 失败会抛出 AdminOfflineError / AdminPermissionError / AdminApiError，
 * 由页面渲染对应的 error / 断网 / 权限失败状态。
 *
 * PBL 硬门禁（`theoryMasteredGate`）在写侧类型上恒为字面量 `true`，
 * 客户端无法把它写成 `false`；服务端仍是最终裁判。
 */
import type {
  AdminTeamConfig,
  AdminTeamCreateInput,
  AdminTeamUpdateInput,
} from '@qitu/contracts';
import { adminEnvelopeRequest, newIdempotencyKey } from './types';

const ADMIN_TEAMS_PATH = '/api/v1/admin/ai-runtime/teams';

const ADMIN_TEAM_ITEM_PATH = (id: string) => `${ADMIN_TEAMS_PATH}/${encodeURIComponent(id)}`;

/** 团队列表；空数组是合法的 empty 态，由页面渲染「暂无团队」。 */
export function fetchAdminTeams(): Promise<AdminTeamConfig[]> {
  return adminEnvelopeRequest<AdminTeamConfig[]>({
    path: ADMIN_TEAMS_PATH,
    method: 'GET',
  });
}

/**
 * 创建团队（POST）。服务端校验：`members.length >= 1`、
 * `leaderAssistantId` 必须命中某个成员、`concurrencyLimit` 在 1–8；
 * 失败时错误码与提示原样上抛，由表单渲染。
 */
export function createAdminTeam(
  input: AdminTeamCreateInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<AdminTeamConfig> {
  return adminEnvelopeRequest<AdminTeamConfig>({
    path: ADMIN_TEAMS_PATH,
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

/**
 * 更新团队（PATCH）。`members` 为整体替换语义；空补丁会被服务端拒绝，
 * 错误（含字段级校验）原样上抛显示，不吞掉。
 */
export function updateAdminTeam(
  id: string,
  patch: AdminTeamUpdateInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<AdminTeamConfig> {
  return adminEnvelopeRequest<AdminTeamConfig>({
    path: ADMIN_TEAM_ITEM_PATH(id),
    method: 'PATCH',
    body: patch,
    idempotencyKey,
  });
}
