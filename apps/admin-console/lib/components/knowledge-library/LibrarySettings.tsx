'use client';

import { useState } from 'react';
import type { EngineGroup } from '../../api/knowledge-center';
import { ImaLibraryPicker } from './ImaLibraryPicker';
import { connectionDiagnostic } from './connection-checks';
import type { LibraryEditor } from './useLibraryEditor';
import { time } from './shared';
import styles from './LibraryWorkspace.module.css';

export function LibrarySettings({
  editor,
  engines,
  online,
  disabled,
  onBindings,
}: {
  editor: LibraryEditor;
  engines: EngineGroup[];
  online: boolean;
  disabled: boolean;
  onBindings: () => void;
}) {
  const { base, basePath, execute, settings } = editor;
  const [name, setName] = useState(base.name);
  const [selection, setSelection] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const group = engines.find((g) => g.instances.some((i) => i.id === base.engine_instance_id));
  const engine = group?.instances.find((i) => i.id === base.engine_instance_id);
  const remote = !!base.connection && base.connection.status !== 'not_applicable';
  const state = connectionDiagnostic(
    base.connection?.status ?? null,
    base.connection?.lastErrorCode ?? null,
    base.connection?.lastCheckAt ?? null,
  );
  return (
    <div className={styles.form}>
      <section className={styles.card}>
        <h3>基本设置</h3>
        <label>
          知识库名称
          <input
            aria-label="知识库名称"
            value={name}
            maxLength={160}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <button
            disabled={disabled || !name.trim() || name === base.name}
            onClick={() => void settings({ name })}
          >
            保存名称
          </button>
          <button
            disabled={disabled}
            onClick={() => void settings({ enabled: base.library_settings?.enabled === false })}
          >
            {base.library_settings?.enabled === false ? '启用知识库' : '停用知识库'}
          </button>
          <button
            disabled={disabled || base.library_settings?.isDefault}
            onClick={() => void settings({ isDefault: true })}
          >
            {base.library_settings?.isDefault ? '当前默认库' : '设为默认库'}
          </button>
        </div>
      </section>
      {remote && (
        <section className={styles.card}>
          <h3>连接与资源</h3>
          <p>
            状态：{state.label} · 最近检查：{time(base.connection?.lastCheckAt)}
          </p>
          {base.connection?.lastErrorCode && (
            <p className={styles.error}>{base.connection.lastErrorCode}</p>
          )}
          <p>{state.detail}</p>
          <p>原文件由原服务维护。连接检查、知识检索与原文读取分别验证。</p>
          <div className={styles.actions}>
            <button
              disabled={disabled}
              onClick={() => void execute(`${basePath}/check`, { expectedRevision: base.revision })}
            >
              检查连接
            </button>
            {engine?.provider === 'ima' && (
              <>
                <button
                  disabled={disabled}
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelection('');
                  }}
                >
                  重新关联
                </button>
                <a href="https://ima.qq.com" target="_blank" rel="noreferrer">
                  前往 ima 管理文件
                </a>
              </>
            )}
          </div>
          {selecting && engine && (
            <div>
              <ImaLibraryPicker
                key={engine.id}
                instanceId={engine.id}
                engine={engine}
                saved
                online={online}
                disabled={disabled}
                selectedId={selection}
                onSelect={setSelection}
                onLoading={setPickerBusy}
              />
              <p>确认资源后更新此连接，保留原助手绑定。旧项目继续按原冻结教材范围执行。</p>
              <button
                disabled={disabled || pickerBusy || !selection}
                onClick={async () => {
                  if (
                    await execute(
                      `${basePath}/connection`,
                      { expectedRevision: base.revision, remoteKnowledgeBaseId: selection },
                      'PATCH',
                    )
                  ) {
                    setSelecting(false);
                    setSelection('');
                  }
                }}
              >
                验证并保存关联
              </button>
            </div>
          )}
        </section>
      )}
      <section className={styles.card}>
        <h3>助手授权</h3>
        <p>通过知识库列表中的助手绑定矩阵统一管理。</p>
        <button disabled={disabled} onClick={onBindings}>
          查看助手绑定
        </button>
      </section>
      <section className={styles.card}>
        <h3>移除配置</h3>
        <p>删除此知识库配置会停止助手访问，远端原文件保留。</p>
        <button
          className={styles.danger}
          disabled={disabled}
          onClick={() => {
            if (window.confirm(`删除知识库配置“${base.name}”？`)) void settings({ deleted: true });
          }}
        >
          删除知识库配置
        </button>
      </section>
    </div>
  );
}
