/**
 * 管理后台 API 层类型与错误分类。
 */

export class AdminOfflineError extends Error {
  constructor() {
    super('无法连接服务器');
    this.name = 'AdminOfflineError';
  }
}

export class AdminPermissionError extends Error {
  constructor(message?: string) {
    super(message ?? '当前账号没有访问该资源的权限');
    this.name = 'AdminPermissionError';
  }
}

export interface DataEnvelope<T> {
  data: T;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}
