'use client';

import { useState } from 'react';
import type { EngineGroup } from '../../api/knowledge-center';
import { LibraryConnectionEditor } from './LibraryConnectionEditor';
import { LibraryEngineConnection } from './LibraryEngineConnection';
import type { LibraryEditor } from './useLibraryEditor';
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
  const { base, settings } = editor;
  const [name, setName] = useState(base.name);
  const [accountDirty, setAccountDirty] = useState(false);
  const group = engines.find((g) => g.instances.some((i) => i.id === base.engine_instance_id));
  const engine = group?.instances.find((i) => i.id === base.engine_instance_id);
  const remote = !!base.connection && base.connection.status !== 'not_applicable';
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
      {engine &&
        ['ima', 'weknora', 'lightrag-server', 'pageindex', 'kiwix'].includes(engine.provider) && (
          <LibraryEngineConnection
            key={engine.id}
            instance={engine}
            editor={editor}
            disabled={disabled}
            onDirty={setAccountDirty}
          />
        )}
      {remote && (
        <LibraryConnectionEditor
          editor={editor}
          engine={engine}
          online={online}
          disabled={disabled}
          accountDirty={accountDirty}
        />
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
