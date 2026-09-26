/**
 * 统一身份与登录契约。
 *
 * 学生 / 家长 / 班主任 / 管理员四个平台共用同一个登录入口与同一套会话契约。
 * 这里只描述「公开投影」——口令、口令哈希、内部风控标签永不出现在契约里。
 */
export type Role = 'student' | 'parent' | 'teacher' | 'admin' | 'support';

/** 当前登录用户的公开投影。 */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

/** @deprecated 使用 `CurrentUser`；保留旧名以免破坏既有引用。 */
export type AuthLoginResponse = CurrentUser;

export interface LoginRequest {
  email: string;
  password: string;
  /**
   * 记住我。为 true 时服务端下发长期会话（30 天），否则使用默认的 8 小时。
   * 这是「登录成功后不用反复重新登录」的服务端依据；客户端缓存只负责省掉
   * 首次校验的等待，不能替代它。
   */
  rememberMe?: boolean;
}

export interface LoginResponse {
  user: CurrentUser;
  /** 会话过期时间（ISO 8601）。 */
  expiresAt: string;
}

/** `GET /auth/session` 的响应体（严格形状）。 */
export type SessionResponse = LoginResponse;

/**
 * `GET /auth/me` 的响应体。
 *
 * 它是 `LoginResponse` 的超集：除了 `user` / `expiresAt`，还平铺了一份
 * `CurrentUser` 字段。这是为了兼容早期直接读取 `data.role` / `data.id` 的
 * 客户端；新代码请只用 `user`，或改用严格形状的 `GET /auth/session`。
 * 平铺字段不会包含口令、会话令牌或任何内部字段。
 */
export type MeResponse = CurrentUser & LoginResponse;

export interface LogoutResponse {
  ok: true;
}
