'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './ModelSettingsPrototype.module.css';

type SectionIconName = 'profile' | 'settings' | 'shield' | 'skills' | 'mcp';

function SectionIcon({ name }: { name: SectionIconName }) {
  const paths: Record<SectionIconName, React.ReactNode> = {
    profile: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.7-3.7 3-5.5 7-5.5s6.3 1.8 7 5.5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 3.1-.2-.1a1.7 1.7 0 0 0-1.9.2l-.2.1h-3.5l-.1-.2a1.7 1.7 0 0 0-1.6-1.1 1.7 1.7 0 0 0-.9.3l-.2.1-3.1-1.8.1-.2a1.7 1.7 0 0 0-.2-1.9l-.1-.2v-3.5l.2-.1a1.7 1.7 0 0 0 1.1-1.6 1.7 1.7 0 0 0-.3-.9l-.1-.2 1.8-3.1.2.1a1.7 1.7 0 0 0 1.9-.2l.2-.1h3.5l.1.2a1.7 1.7 0 0 0 1.6 1.1 1.7 1.7 0 0 0 .9-.3l.2-.1 3.1 1.8-.1.2a1.7 1.7 0 0 0 .2 1.9l.1.2v3.5l-.2.1a1.7 1.7 0 0 0-1.1 1.6" /></>,
    shield: <><path d="M12 3.5 19 6v5.2c0 4.3-2.5 7.5-7 9.3-4.5-1.8-7-5-7-9.3V6l7-2.5Z" /><path d="m9 12 2 2 4-4" /></>,
    skills: <><path d="M12 3.5 14 8l4.5.5-3.3 3.1.9 4.5L12 14l-4.1 2.1.9-4.5-3.3-3.1L10 8l2-4.5Z" /><path d="m18.5 16 .8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7Z" /></>,
    mcp: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="m7.7 7.2 2.9 8.1M16.3 7.2l-2.9 8.1M8 6h8" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const SKILL_CHOICES = [
  ['guided', '苏格拉底式引导'],
  ['hint', '分层提示'],
  ['planning', '学习计划拆解'],
  ['project', '项目式实践'],
  ['escalation', '卡顿与风险升级'],
] as const;

function Badge({ children, tone }: { children: React.ReactNode; tone: 'live' | 'session' }) {
  return <span className={`${styles.badge} ${tone === 'live' ? styles.badgeLive : styles.badgeSession}`}>{children}</span>;
}

export function ModelSettingsPrototype() {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [expanded, setExpanded] = useState(false);
  const [skills, setSkills] = useState<string[]>(SKILL_CHOICES.map(([id]) => id));
  const [prompt, setPrompt] = useState('你是启途智学的 AI 学习搭档。\n\n以苏格拉底式提问引导学生思考，优先给出简短提示，不直接代替学生完成任务。根据学生年龄调整表达难度；涉及安全、情绪或持续卡顿时，及时建议联系班主任。');

  return (
    <section className={styles.prototype} aria-labelledby="model-settings-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>运行时配置 · 原型</p>
          <h2 id="model-settings-title">AI 学习搭档</h2>
          <p className={styles.subtitle}>配置 Agent 默认行为、模型参数与安全边界。</p>
        </div>
        <Link className={styles.headerLink} href="/settings/ai-runtime">管理 Agent <span aria-hidden="true">→</span></Link>
      </header>

      <div className={styles.sections}>
        <section className={styles.section} aria-labelledby="agent-profile-title">
          <div className={styles.sectionHeading}>
            <span className={styles.icon}><SectionIcon name="profile" /></span>
            <div><h3 id="agent-profile-title">基础信息</h3><p>身份与默认服务配置</p></div>
            <Badge tone="live">立即生效</Badge>
          </div>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Agent 名称</span>
              <input defaultValue="AI 学习搭档" />
              <small>面向学生展示的助手名称。</small>
            </label>
            <label className={styles.field}>
              <span>运行状态</span>
              <select defaultValue="enabled"><option value="enabled">已启用</option><option value="paused">已暂停</option></select>
              <small>暂停后将停止接受新的对话请求。</small>
            </label>
            <label className={`${styles.field} ${styles.wide}`}>
              <span>默认模型</span>
              <select defaultValue="qwen3.8-flash"><option value="qwen3.8-flash">Qwen 3.8 Flash · 百炼</option><option value="select">从已登记模型中选择…</option></select>
              <small>模型由服务端登记与授权。<Link href="/settings/model-providers">管理模型供应商</Link></small>
            </label>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="model-params-title">
          <div className={styles.sectionHeading}>
            <span className={styles.icon}><SectionIcon name="settings" /></span>
            <div><h3 id="model-params-title">模型参数</h3><p>控制回答的稳定性与长度</p></div>
            <Badge tone="session">仅对新会话生效</Badge>
          </div>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>温度</span>
              <div className={styles.inlineControl}><input type="number" min="0" max="2" step="0.1" defaultValue="0.7" /><span>0.7</span></div>
              <small>较低值让回答更稳定，范围 0–2。</small>
            </label>
            <label className={styles.field}>
              <span>最大输出 Token</span>
              <input type="number" min="256" max="8192" step="256" defaultValue="2048" />
              <small>限制单次回答长度，避免输出过长。</small>
            </label>
            <label className={`${styles.field} ${styles.wide}`}>
              <span>响应策略</span>
              <select defaultValue="balanced"><option value="balanced">平衡 · 兼顾速度与完整度</option><option value="fast">快速 · 优先降低响应延迟</option><option value="careful">审慎 · 优先完整推理</option></select>
              <small>策略变更将在下一次新会话中应用。</small>
            </label>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="skills-title">
          <div className={styles.sectionHeading}>
            <span className={styles.icon}><SectionIcon name="skills" /></span>
            <div><h3 id="skills-title">技能（Skills）</h3><p>为 Agent 选择可调用的专业技能</p></div>
            <Badge tone="session">仅对新会话生效</Badge>
          </div>
          <div className={styles.fields}>
            <div className={`${styles.field} ${styles.wide}`}>
              <span>已启用技能</span>
              <details className={styles.multiSelect}>
                <summary className={styles.multiSelectTrigger} aria-label={`已选择 ${skills.length} 项技能`}>
                  <span>已选 {skills.length} 项</span><span className={styles.selectChevron} aria-hidden="true">⌄</span>
                </summary>
                <div className={styles.multiSelectOptions}>
                  {SKILL_CHOICES.map(([id, label]) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={skills.includes(id)}
                        onChange={(event) => setSkills((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </details>
              <small>快捷选择当前 Agent 已启用的技能。<Link className={styles.auxiliaryLink} href="/settings/ai-runtime">前往技能中心管理</Link></small>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="mcp-title">
          <div className={styles.sectionHeading}>
            <span className={styles.icon}><SectionIcon name="mcp" /></span>
            <div><h3 id="mcp-title">MCP 配置</h3><p>选择工具连接与会话记忆方式</p></div>
            <Badge tone="live">立即生效</Badge>
          </div>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.wide}`}>
              <span>连接偏好</span>
              <select defaultValue="remember-last" aria-label="MCP 连接偏好">
                <option value="remember-last">自动记住上次</option>
                <option value="default">始终使用默认连接</option>
                <option value="ask">每次询问</option>
              </select>
              <small>连接凭据和服务器由后台安全管理。<Link className={styles.auxiliaryLink} href="/settings/ai-runtime?tab=mcp">前往 MCP 设置</Link></small>
            </label>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="safety-title">
          <div className={styles.sectionHeading}>
            <span className={styles.icon}><SectionIcon name="shield" /></span>
            <div><h3 id="safety-title">安全策略</h3><p>回答边界与风险升级</p></div>
            <Badge tone="live">立即生效</Badge>
          </div>
          <div className={styles.policyList}>
            <label className={styles.policy}><span><strong>答案泄露防护</strong><small>优先提供分步提示，不直接输出完整解答。</small></span><input type="checkbox" defaultChecked /></label>
            <label className={styles.policy}><span><strong>高风险内容拦截</strong><small>遇到不适龄或安全风险内容时停止生成并提示求助。</small></span><input type="checkbox" defaultChecked /></label>
            <div className={styles.policyHint}>策略由服务端执行并留存审计记录。<Link href="/settings/ai-runtime">查看运行时治理</Link></div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.promptSection}`} aria-labelledby="prompt-title">
          <div className={styles.promptHeading}>
            <div className={styles.sectionHeading}>
              <span className={styles.icon}><SectionIcon name="profile" /></span>
              <div><h3 id="prompt-title">系统提示词</h3><p>定义 Agent 的角色、语气与行为规则</p></div>
              <Badge tone="session">仅对新会话生效</Badge>
            </div>
            <div className={styles.editorActions}>
              <button type="button" className={mode === 'edit' ? styles.activeAction : ''} onClick={() => setMode('edit')}>编辑</button>
              <button type="button" className={mode === 'preview' ? styles.activeAction : ''} onClick={() => setMode('preview')}>预览</button>
              <button type="button" aria-label={expanded ? '收起编辑器' : '展开编辑器'} title={expanded ? '收起' : '展开'} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'} <span aria-hidden="true">↗</span></button>
            </div>
          </div>
          {mode === 'edit' ? <textarea className={`${styles.editor} ${expanded ? styles.editorExpanded : ''}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="系统提示词" /> : <pre className={`${styles.preview} ${expanded ? styles.editorExpanded : ''}`}>{prompt || '暂无提示词内容'}</pre>}
          <div className={styles.editorFooter}><span>{prompt.length} 个字符</span><span>提示词由服务端安全加载，不包含密钥或个人敏感信息。</span></div>
        </section>
      </div>
      <footer className={styles.prototypeFooter}><span>原型预览 · 配置变更请前往对应管理页保存</span><Link href="/settings/ai-runtime">打开 AI 运行时 <span aria-hidden="true">→</span></Link></footer>
    </section>
  );
}
