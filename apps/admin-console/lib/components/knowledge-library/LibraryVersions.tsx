'use client';

import { useState } from 'react';
import type { EngineGroup } from '../../api/knowledge-center';
import type { LibraryEditor } from './useLibraryEditor';
import { statusLabels, time } from './shared';
import styles from './LibraryWorkspace.module.css';

export function LibraryVersions({
  editor,
  engines,
  disabled,
}: {
  editor: LibraryEditor;
  engines: EngineGroup[];
  disabled: boolean;
}) {
  const { base, basePath, execute, settings } = editor;
  const [engineChoice, setEngineChoice] = useState(base.engine_instance_id ?? '');
  const activeJob = base.jobs.some(
    (job) => !['ready', 'failed', 'empty', 'cancelled'].includes(job.state),
  );
  return (
    <div className={styles.form}>
      <section className={styles.card}>
        <h3>索引构建</h3>
        <p>重建成功后才切换到新索引；失败时保留已有有效版本。</p>
        <label>
          索引引擎
          <select
            aria-label="索引引擎"
            disabled={disabled}
            value={engineChoice}
            onChange={(event) => setEngineChoice(event.target.value)}
          >
            <option value="" disabled>
              请选择引擎
            </option>
            {engines
              .filter((group) =>
                ['llamaindex', 'graphrag', 'lightrag', 'pageindex', 'pageindex-oss'].includes(
                  group.provider,
                ),
              )
              .flatMap((group) =>
                group.instances
                  .filter((engine) => engine.enabled)
                  .map((engine) => (
                    <option value={engine.id} key={engine.id}>
                      {group.name} · {engine.name}
                    </option>
                  )),
              )}
          </select>
        </label>
        <div className={styles.actions}>
          <button
            disabled={disabled || !engineChoice || engineChoice === base.engine_instance_id}
            onClick={() => void settings({ engineInstanceId: engineChoice })}
          >
            保存引擎，等待重建索引
          </button>
          <button
            disabled={disabled || activeJob}
            onClick={() => void execute(`${basePath}/rebuild`, {})}
          >
            重建索引
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h3>索引版本</h3>
        {!base.versions.length && <p>尚无索引版本</p>}
        {base.versions.map((version) => (
          <div key={version.id} className={styles.versionRow}>
            <strong>
              {version.id === base.active_index_version_id
                ? '当前有效版本'
                : (statusLabels[version.status] ?? version.status)}
            </strong>
            <span>{time(version.created_at)}</span>
            <code>{version.id}</code>
          </div>
        ))}
      </section>
      <section className={styles.card}>
        <h3>构建记录</h3>
        {!base.jobs.length && <p>尚无构建任务</p>}
        {base.jobs.map((job) => (
          <div key={job.id} className={styles.versionRow}>
            <span>{statusLabels[job.state] ?? job.state}</span>
            <code>{job.error_code ?? job.id}</code>
          </div>
        ))}
      </section>
    </div>
  );
}
