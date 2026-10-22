/** Stable diagnostics only: never return exception messages or upstream request details. */
export function imaConnectionMessage(code?: string): string {
  const messages: Record<string, string> = {
    ENGINE_NEEDS_KEY: '请填写同一 ima 账户的 Client ID 和 API Key。',
    IMA_CREDENTIALS_REJECTED: 'ima 拒绝了凭证或访问权限，请检查 Client ID、API Key 和知识库授权。',
    IMA_RATE_LIMITED: 'ima 请求频率已达上限，请稍后重试。',
    IMA_TIMEOUT: '连接 ima 超时，请稍后重试。',
    IMA_UNREACHABLE: '服务器暂时无法连接 ima，请检查网络后重试。',
    IMA_UPSTREAM_INVALID_RESPONSE: 'ima 接口暂不可用或返回异常，请稍后重试。',
    IMA_KB_ID_IS_CLIENT_ID: '这里需要知识库 ID，不能填写 Client ID。请验证凭证并从列表选择知识库。',
    IMA_KB_ID_INVALID: '关联库 ID 无效，请重新读取 ima 官方知识库列表并重新关联。',
    REMOTE_RESOURCE_NOT_FOUND:
      '凭证已被 ima 接受，但此知识库 ID 不存在或不可访问。请从列表选择 OpenAPI 知识库 ID，不要使用页面内部 ID。',
    ENGINE_CLOUD_URL_UNSUPPORTED: 'ima 服务地址应为 https://ima.qq.com。',
    ENGINE_DEPENDENCY_MISSING: '服务器缺少 ima 接口依赖，请联系管理员。',
    ENGINE_DISABLED: 'ima 引擎已停用，请先启用。',
  };
  return messages[code ?? ''] ?? 'ima 连接未通过，请重新验证凭证并选择可访问的知识库。';
}
