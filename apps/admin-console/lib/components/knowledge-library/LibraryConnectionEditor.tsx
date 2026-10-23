'use client';

import { useState } from 'react';
import type { EngineGroup } from '../../api/knowledge-center';
import { ImaLibraryPicker } from './ImaLibraryPicker';
import { connectionDiagnostic } from './connection-checks';
import type { LibraryEditor } from './useLibraryEditor';
import { time } from './shared';
import styles from './LibraryWorkspace.module.css';

const fields: Record<string, [string, string][]> = {
  ima: [['remoteKnowledgeBaseId', '知识库 ID']],
  weknora: [
    ['serverUrl', '当前知识库服务地址'],
    ['remoteKnowledgeBaseId', '知识库 ID'],
  ],
  'lightrag-server': [
    ['serverUrl', '当前知识库服务地址'],
    ['workspace', 'Workspace（可选）'],
  ],
  kiwix: [
    ['serverUrl', '当前知识库服务地址'],
    ['zimName', 'ZIM 名称'],
  ],
};

export function LibraryConnectionEditor({
  editor,
  engine,
  disabled,
  online,
  accountDirty,
}: {
  editor: LibraryEditor;
  engine?: EngineGroup['instances'][number];
  disabled: boolean;
  online: boolean;
  accountDirty: boolean;
}) {
  const { base, basePath, execute } = editor;
  const provider = base.connection?.provider ?? engine?.provider ?? '';
  const editable = fields[provider] ?? [];
  const savedValue = (key: string) =>
    String(
      base.connection?.externalRef?.[key] ??
        (key === 'serverUrl' ? (engine?.config.server_url ?? '') : ''),
    );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map(([key]) => [key, savedValue(key)])),
  );
  const [selecting, setSelecting] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const dirty = editable.some(([key]) => draft[key]?.trim() !== savedValue(key));
  const state = connectionDiagnostic(
    base.connection?.status ?? null,
    base.connection?.lastErrorCode ?? null,
    base.connection?.lastCheckAt ?? null,
  );
  const blocked = disabled || accountDirty;
  return (
    <section className={styles.card}>
      <h3>连接与资源</h3>
      <p>
        状态：{state.label} · 最近检查：{time(base.connection?.lastCheckAt)}
      </p>
      {base.connection?.lastErrorCode && (
        <p className={styles.error}>{base.connection.lastErrorCode}</p>
      )}
      <p>{state.detail}</p>
      {accountDirty && <p>请先保存或重新读取上方账号配置，再验证当前知识库。</p>}
      {!!editable.length && (
        <>
          <p>以下修改仅作用于当前知识库；验证成功后更新连接，保留助手绑定。</p>
          {editable.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                type={key === 'serverUrl' ? 'url' : 'text'}
                value={draft[key] ?? ''}
                disabled={blocked}
                autoComplete="off"
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
          {provider === 'ima' && engine && (
            <>
              <button disabled={blocked || pickerBusy} onClick={() => setSelecting(!selecting)}>
                {selecting ? '收起账户知识库' : '从账户选择知识库'}
              </button>
              {selecting && (
                <ImaLibraryPicker
                  key={`${engine.id}:${engine.revision}`}
                  instanceId={engine.id}
                  engine={engine}
                  saved
                  online={online}
                  disabled={blocked}
                  selectedId={draft.remoteKnowledgeBaseId ?? ''}
                  onSelect={(id) => setDraft((value) => ({ ...value, remoteKnowledgeBaseId: id }))}
                  onLoading={setPickerBusy}
                />
              )}
            </>
          )}
          <div className={styles.actions}>
            <button
              disabled={
                blocked ||
                pickerBusy ||
                !dirty ||
                editable.some(([key]) => key !== 'workspace' && !draft[key]?.trim())
              }
              onClick={async () => {
                if (
                  await execute(
                    `${basePath}/connection`,
                    {
                      expectedRevision: base.revision,
                      connection: Object.fromEntries(
                        editable.map(([key]) => [key, draft[key]?.trim() ?? '']),
                      ),
                    },
                    'PATCH',
                  )
                )
                  setSelecting(false);
              }}
            >
              验证并保存连接
            </button>
          </div>
        </>
      )}
      <div className={styles.actions}>
        <button
          disabled={blocked || dirty}
          onClick={() => void execute(`${basePath}/check`, { expectedRevision: base.revision })}
        >
          检查连接
        </button>
        {provider === 'ima' && (
          <a href="https://ima.qq.com" target="_blank" rel="noreferrer">
            前往 ima 管理文件
          </a>
        )}
      </div>
      <p>原文件由原服务维护。保存成功与文件可读分别验证；原文和目录在“文件”页查看。</p>
    </section>
  );
}
