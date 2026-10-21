import type { AdminRuntimeSnapshot, AdminTeamConfig, TeachingBundleDraft } from '@qitu/contracts';
import type { PublishedTeamMember } from '../../api/template-bindings';
import { publishedMemberName, togglePublishedSkill, togglePublishedTool } from './model';
import styles from './TeachingBinding.module.css';

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
      <section className={styles.inspectorSection}><h4>发布模型</h4>
        {model ? <><strong>{modelLabel ? `${modelLabel.providerLabel} / ${modelLabel.modelLabel}` : `${model.modelProviderId} / ${model.modelId}`}</strong>
          {catalog && !modelLabel?.available && <p className={styles.issue}>此发布模型当前不可用，请检查模型目录。</p>}
          <small>沿用此团队版本的模型。更换模型需重新发布团队版本。</small></> : <p className={styles.issue}>此版本没有可读取的模型快照。</p>}
      </section>
      <section className={styles.inspectorSection}><h4>教学方法 Skills</h4>
        {!snapshot ? <p className={styles.issue}>此版本没有可读取的技能快照。</p> : !snapshot.skills.length ? <p className={styles.muted}>未发布教学技能</p> :
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
        {draft && !roles.length && <small>此导师尚未分配教学角色，当前展示发布能力。</small>}
      </section>
      <section className={styles.inspectorSection}><h4>工具与 MCP</h4>
        {!snapshot ? <p className={styles.issue}>此版本没有可读取的工具快照。</p> : !snapshot.tools.length && !snapshot.mcpPermissions.length
          ? <p className={styles.muted}>未发布工具权限</p> : (roles.length ? roles : [null]).map((role) => <fieldset
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
