import { BadRequestException } from '@nestjs/common';
import { parseKnowledgeBaseConnection, record } from './knowledge-center.config';

const fields: Record<string, string[]> = {
  ima: ['remoteKnowledgeBaseId'],
  weknora: ['serverUrl', 'remoteKnowledgeBaseId'],
  'lightrag-server': ['serverUrl', 'workspace'],
  kiwix: ['serverUrl', 'zimName'],
};

/** Edit resource pointers only; account credentials remain in the Admin engine configuration. */
export function editedKnowledgeConnection(
  provider: string,
  previous: Record<string, string>,
  raw: unknown,
) {
  const allowed = fields[provider];
  if (!allowed)
    throw new BadRequestException({
      code: 'REMOTE_CONNECTION_UNSUPPORTED',
      message: '此来源暂不支持在线修改连接',
    });
  const patch = record(raw);
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.includes(key)))
    throw new BadRequestException({
      code: 'CONFIG_INVALID',
      message: '连接字段无效；账号凭证请在引擎配置中编辑',
    });
  const merged = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string')
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '连接字段须为文本' });
    if (key === 'workspace' && !value.trim()) delete merged.workspace;
    else merged[key] = value;
  }
  const { externalRef } = parseKnowledgeBaseConnection(provider, 'link_existing', merged);
  const required =
    provider === 'ima'
      ? ['remoteKnowledgeBaseId']
      : provider === 'weknora'
        ? ['serverUrl', 'remoteKnowledgeBaseId']
        : provider === 'kiwix'
          ? ['serverUrl', 'zimName']
          : ['serverUrl'];
  if (
    required.some((key) => !externalRef[key]) ||
    (externalRef.remoteKnowledgeBaseId?.length ?? 0) > 512
  )
    throw new BadRequestException({
      code: 'CONFIG_INVALID',
      message: '请填写有效的服务地址和资源标识',
    });
  return externalRef;
}
