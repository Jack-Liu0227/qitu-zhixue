'use client';

import { useEffect, useState } from 'react';
import { fetchCenterConfig, type Engine, type EngineGroup } from '../../api/knowledge-center';
import { RemoteConnectionFields } from '../knowledge-engines/RemoteConnectionFields';
import { LibraryReadbackConflict, type LibraryEditor } from './useLibraryEditor';
import styles from './LibraryWorkspace.module.css';

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const engineValue = (engine: Engine): Engine => ({
  name: engine.name,
  provider: engine.provider,
  description: engine.description,
  enabled: engine.enabled,
  config: structuredClone(engine.config),
});

export function LibraryEngineConnection({
  instance,
  editor,
  disabled,
  onDirty,
}: {
  instance: EngineGroup['instances'][number];
  editor: LibraryEditor;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const [original, setOriginal] = useState(() => engineValue(instance));
  const [draft, setDraft] = useState(original);
  const dirty = canonical(draft) !== canonical(original);
  const changedElsewhere = canonical(engineValue(instance)) !== canonical(original);
  useEffect(() => {
    onDirty(dirty || changedElsewhere);
  }, [dirty, changedElsewhere, onDirty]);
  async function save() {
    const submitted = structuredClone(draft);
    await editor.execute(
      'platform-config',
      async () => {
        const current = await fetchCenterConfig();
        if (canonical(current.config.knowledgeEngines[instance.id]) !== canonical(original))
          throw new Error('此引擎已在其他页面修改，请重新读取引擎配置后编辑。');
        const config = structuredClone(current.config);
        config.knowledgeEngines[instance.id] = submitted;
        return { expectedRevision: current.revision, config };
      },
      'PUT',
      async () => {
        const current = await fetchCenterConfig();
        const saved = current.config.knowledgeEngines[instance.id];
        if (canonical(saved) !== canonical(submitted))
          throw new LibraryReadbackConflict(
            '回读发现引擎已被其他操作更新，请重新读取引擎配置；本次不能确认生效。',
          );
        setOriginal(saved!);
        setDraft(saved!);
      },
    );
  }
  return (
    <section className={styles.card} aria-label="引擎连接配置">
      <h3>账号与服务配置</h3>
      <p>
        编辑共享引擎「{instance.name}」。保存将影响使用此引擎的 {instance.associatedBases.length}{' '}
        个知识库：{instance.associatedBases.map((base) => base.name).join('、') || editor.base.name}
        。
      </p>
      <div className={styles.accountFields}>
        <RemoteConnectionFields
          prefix={`library-${instance.id}`}
          draft={draft}
          disabled={disabled}
          onChange={setDraft}
          showDefaultResource={false}
        />
      </div>
      {changedElsewhere && (
        <p className={styles.error} role="alert">
          引擎配置已变化，请重新读取后编辑。
        </p>
      )}
      <div className={styles.actions}>
        <button disabled={disabled || !dirty || changedElsewhere} onClick={() => void save()}>
          保存引擎连接配置
        </button>
        <button
          disabled={disabled}
          onClick={async () => {
            if (dirty && !window.confirm('重新读取将替换未保存的引擎配置，继续？')) return;
            await editor.readEngine(instance.id, (engine) => {
              setOriginal(engine);
              setDraft(engine);
            });
          }}
        >
          重新读取引擎配置
        </button>
      </div>
      <p>保存后请在下方检查当前知识库连接。单库地址与资源标识在“连接与资源”中单独保存。</p>
    </section>
  );
}
