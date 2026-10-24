import type { AdminRuntimeSnapshot, AdminTeamConfig, TeachingBundleDraft } from '@qitu/contracts';
import type { PublishedTeamMember } from '../../api/template-bindings';
import { publishedMemberName, togglePublishedSkill, togglePublishedTool } from './model';
import styles from './TeachingBinding.module.css';
import Link from 'next/link';

export function TeachingRoleInspector({ member, team, draft, catalog, editable, onDraft }: {
  member?: PublishedTeamMember; team?: AdminTeamConfig; draft: TeachingBundleDraft | null; catalog: AdminRuntimeSnapshot | null;
  editable: boolean; onDraft: (draft: TeachingBundleDraft) => void;
}) {
  const snapshot = member?.runtimeSnapshot;
  const roles = draft?.roleMap.filter((role) => role.memberId === member?.slotId) ?? [];
  const model = snapshot?.model;
  const modelLabel = catalog?.modelOptions.find((item) => item.providerId === model?.modelProviderId && item.modelId === model?.modelId);
  const toolName = (id: string) => catalog?.builtInTools.find((tool) => tool.id === id)?.label ?? id;
  function toggleTool(roleSlotId: string, toolId: string, checked: boolean) {
    if (!draft || !member || !snapshot || !roles.some((role) => role.roleSlotId === roleSlotId)) return;
    onDraft(togglePublishedTool(draft, roleSlotId, member, toolId, checked));
  }
  return <aside className={styles.inspector} aria-label="当前导师配置">
    <header className={styles.columnHeader}><h3>当前导师配置</h3></header>
    {!member ? <div className={styles.empty}>选择一位导师，查看教学能力与资料范围。</div> : <>
      <div className={styles.inspectorIdentity}><span className={styles.avatar}>{publishedMemberName(member, team).slice(0, 1)}</span>
        <div><strong>{publishedMemberName(member, team)}</strong><span>{member.roleLabel || member.role || '团队导师'}</span></div></div>
      <div style={{ margin: '8px 0 12px' }}>
        <Link
          href={`/settings/assistants?assistantId=${encodeURIComponent(member.assistantId)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: '#165dff',
            textDecoration: 'none',
            padding: '4px 10px',
            background: '#f2f3f5',
            borderRadius: '4px',
            border: '1px solid #e5e6eb',
            fontWeight: 500,
          }}
          title="在新窗口打开该导师的助手配置，可编辑模型底座、系统提示词与技能矩阵"
        >
          ✏️ 编辑导师助手能力 (模型/Prompt/技能) ↗
        </Link>
      </div>
      <section className={styles.inspectorSection}><h4>教学模型</h4>
        {model ? <><strong>{modelLabel ? `${modelLabel.providerLabel} / ${modelLabel.modelLabel}` : `${model.modelProviderId} / ${model.modelId}`}</strong>
          {catalog && !modelLabel?.available && <p className={styles.issue}>此教学模型当前不可用，请检查模型目录。</p>}
          <small>模型在助手管理中维护，更改后重新保存教学安排。</small></> : <p className={styles.issue}>请先保存教学安排以读取模型配置。</p>}
      </section>
      <section className={styles.inspectorSection}><h4>教学方法 Skills</h4>
        {!snapshot ? <p className={styles.issue}>请先保存教学安排以读取技能配置。</p> : !snapshot.skills.length ? <p className={styles.muted}>尚未配置教学技能</p> :
          (roles.length ? roles : [null]).map((role) => <fieldset key={role?.roleSlotId ?? 'preview'} className={styles.capabilityList} disabled={!editable || !role || !catalog}>
            {roles.length > 1 && <legend>角色 {role?.roleSlotId}</legend>}
            {snapshot.skills.map((pin) => {
              const current = catalog?.skills.find((skill) => skill.id === pin.canonicalId);
              const available = current?.status === 'ready' && current.publicationStatus === 'published'
                && current.runtime === 'teaching' && current.version === pin.version;
              const selected = role && draft ? draft.skillPins.some((item) => item.roleSlotId === role.roleSlotId && item.canonicalId === pin.canonicalId
                && item.version === pin.version && item.packageDigest === pin.packageDigest) : true;
              return <label key={pin.canonicalId} title={`${pin.canonicalId} · ${pin.version}`}>
                <input type="checkbox" checked={!!selected} disabled={!!catalog && !available}
                  onChange={(event) => { if (draft && role) onDraft(togglePublishedSkill(draft, role.roleSlotId, member, pin.canonicalId, event.target.checked)); }} />
                <span>{current?.label ?? pin.canonicalId}<small>v{pin.version}{catalog && !available ? ' · 当前目录不可用' : ''}</small>
                  {current?.description?.trim() && <small className={styles.skillDescription}>{current.description.replace(/\s+/gu, ' ').trim().slice(0, 120)}</small>}
                </span>
              </label>;
            })}
          </fieldset>)}
        {draft && !roles.length && <small>此导师尚未分配教学角色，当前展示已保存的教学能力。</small>}
      </section>
      <section className={styles.inspectorSection}><h4>工具与 MCP</h4>
        <p className={styles.muted}>缺少工具时，先到 <Link href="/settings/tools">工具授权</Link> 为该助手开启，再重新保存教学安排以读取新配置。</p>
        {!snapshot ? <p className={styles.issue}>请先保存教学安排以读取工具配置。</p> : !snapshot.tools.length && !snapshot.mcpPermissions.length
          ? <p className={styles.muted}>尚未配置工具权限</p> : (roles.length ? roles : [null]).map((role) => <fieldset
            key={role?.roleSlotId ?? 'preview'} className={styles.capabilityList} disabled={!editable || !role || !catalog}>
            {roles.length > 1 && <legend>角色 {role?.roleSlotId}</legend>}
            {[...snapshot.tools.map((tool) => ({ id: tool.toolId, server: null })),
              ...snapshot.mcpPermissions.flatMap((permission) => permission.toolIds.map((id) => ({ id, server: permission.serverId })))].map((tool) =>
              <label key={`${tool.server ?? 'builtin'}:${tool.id}`}><input type="checkbox"
                checked={role && draft ? draft.toolIds.some((entry) => entry.roleSlotId === role.roleSlotId && entry.toolId === tool.id) : true}
                onChange={(event) => { if (role) toggleTool(role.roleSlotId, tool.id, event.target.checked); }} />
                <span>{toolName(tool.id)}{tool.server && <small>MCP · {tool.server}</small>}</span></label>)}
          </fieldset>)}
      </section>
      <section className={styles.inspectorSection}><h4>项目知识范围</h4>
        {!draft?.knowledgeBaseIds.length ? <p className={styles.knowledgeEmpty}>尚未授权知识库</p> : <ul className={styles.resourceList}>
          {draft.knowledgeBaseIds.map((id) => <li key={id}><span>{id}</span>{editable && <button type="button" aria-label={`移除知识库${id}`}
            onClick={() => onDraft({ ...draft, knowledgeBaseIds: draft.knowledgeBaseIds.filter((entry) => entry !== id) })}>移除</button>}</li>)}
        </ul>}
        <small>范围适用于当前教学绑定，运行时仍须校验授权。新增范围可在高级配置中设置已有授权 ID。</small>
      </section>
    </>}
  </aside>;
}
