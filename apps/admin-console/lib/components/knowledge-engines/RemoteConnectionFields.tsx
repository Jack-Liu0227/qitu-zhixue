'use client';

import { useState } from 'react';
import type { Engine } from '../../api/knowledge-center';
import styles from './RemoteEngineSettings.module.css';

// Shared form follows DeepTutor EngineDetail / ImaConnectionFields (6cf793bd, MIT).
export function RemoteConnectionFields({
  draft,
  disabled,
  onChange,
  prefix = 'remote',
  showDefaultResource = true,
}: {
  draft: Engine;
  disabled: boolean;
  onChange: (value: Engine) => void;
  prefix?: string;
  showDefaultResource?: boolean;
}) {
  const [showKey, setShowKey] = useState(true);
  const provider = draft.provider;
  const fixedUrl =
    provider === 'ima'
      ? 'https://ima.qq.com'
      : provider === 'pageindex'
        ? 'https://api.pageindex.ai'
        : '';
  const update = (key: string, value: string) =>
    onChange({
      ...draft,
      config: {
        ...draft.config,
        [key]: value,
        ...(key === 'server_url' && ['lightrag-server', 'weknora'].includes(provider)
          ? { apiKey: '' }
          : {}),
      },
    });
  return (
    <div className={styles.fields}>
      <label htmlFor={`${prefix}-server-url`}>
        服务器地址
        <input
          id={`${prefix}-server-url`}
          aria-label="服务器地址"
          type="url"
          readOnly={!!fixedUrl}
          value={String(draft.config.server_url ?? fixedUrl)}
          placeholder="https://knowledge.example.com"
          onChange={(event) => update('server_url', event.target.value)}
          disabled={disabled}
        />
        {fixedUrl && <small>官方接口地址固定；可在下方修改账号凭证和知识库关联。</small>}
        {fixedUrl && Boolean(draft.config.server_url) && draft.config.server_url !== fixedUrl && (
          <button type="button" disabled={disabled} onClick={() => update('server_url', fixedUrl)}>
            恢复官方地址
          </button>
        )}
      </label>
      {provider === 'ima' && (
        <label htmlFor={`${prefix}-client-id`}>
          CLIENT ID
          <input
            id={`${prefix}-client-id`}
            value={String(draft.config.clientId ?? '')}
            onChange={(event) => update('clientId', event.target.value)}
            autoComplete="off"
            disabled={disabled}
            placeholder="输入你的 ima Client ID"
          />
        </label>
      )}
      {provider !== 'kiwix' && (
        <label htmlFor={`${prefix}-api-key`}>
          API KEY{provider === 'lightrag-server' && <span> · 可选</span>}
          <div className={styles.secretInput}>
            <input
              id={`${prefix}-api-key`}
              aria-label="API KEY"
              type={showKey ? 'text' : 'password'}
              value={String(draft.config.apiKey ?? '')}
              onChange={(event) => update('apiKey', event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              disabled={disabled}
              placeholder="输入 API Key"
            />
            <button
              type="button"
              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
              disabled={disabled}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </label>
      )}
      {provider === 'weknora' && showDefaultResource && (
        <label htmlFor={`${prefix}-kb-id`}>
          默认知识库 ID · 可选
          <input
            id={`${prefix}-kb-id`}
            value={String(draft.config.remoteKnowledgeBaseId ?? '')}
            disabled={disabled}
            onChange={(event) => update('remoteKnowledgeBaseId', event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
