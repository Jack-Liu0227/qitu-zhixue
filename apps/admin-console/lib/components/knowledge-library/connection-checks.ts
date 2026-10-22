import type { KnowledgeMatrixLibrary } from '@qitu/contracts';

export function connectionDiagnostic(
  status: string | null,
  code: string | null,
  checkedAt: string | null,
) {
  if (!checkedAt) return { kind: 'unknown', label: '尚未检测', detail: '请检测当前连接状态。' };
  if (code === 'ENGINE_NEEDS_KEY')
    return { kind: 'auth', label: '缺少认证凭证', detail: '请在知识引擎中补全凭证后重新检测。' };
  if (
    code === 'IMA_CREDENTIALS_REJECTED' ||
    code === 'REMOTE_AUTH_FAILED' ||
    status === 'unauthorized'
  )
    return {
      kind: 'auth',
      label: '认证/授权被拒绝',
      detail: '凭证可能已失效或访问权限已撤销，请在知识引擎检查凭证和授权。',
    };
  if (
    ['IMA_KB_ID_INVALID', 'IMA_KB_ID_IS_CLIENT_ID', 'REMOTE_RESOURCE_NOT_FOUND'].includes(
      code ?? '',
    )
  )
    return {
      kind: 'resource',
      label: '资源不可访问',
      detail: '库 ID 无效、资源不存在或当前账户无权访问，请在配置中核对关联。',
    };
  if (code === 'IMA_RATE_LIMITED')
    return { kind: 'network', label: '请求被限流', detail: '请稍后重试，不能据此判断认证失效。' };
  if (status === 'unreachable' || ['IMA_TIMEOUT', 'IMA_UNREACHABLE'].includes(code ?? ''))
    return {
      kind: 'network',
      label: '网络连接异常',
      detail: '请检查服务端网络后重试，认证状态尚未核实。',
    };
  if (status === 'ready' && !code)
    return {
      kind: 'ready',
      label: '连接检测通过',
      detail: '仅代表最近一次连接检查通过，不代表助手已获授权或所有原文均可读取。',
    };
  return {
    kind: 'unknown',
    label: '连接检测异常',
    detail: '请查看错误码并核对来源配置，认证状态尚未核实。',
  };
}

export const remoteLibraries = (libraries: KnowledgeMatrixLibrary[]) =>
  libraries.filter(
    (library) => library.connectionStatus !== null && library.connectionStatus !== 'not_applicable',
  );
