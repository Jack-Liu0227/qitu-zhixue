'use client';

import { VisualAsset } from '@qitu/ui';
import type { AdminProjectTemplate } from '../../api/content';
import { VisualSelector } from '../VisualAssetPicker';
import styles from './TemplateLibrary.module.css';

const DOMAINS: Record<string, string> = {
  physics: '物理探究', physics_optics: '光学探究', programming_game_dev: '游戏创作', programming: '编程',
  life_science: '生命科学', sustainability: '环境与可持续', mathematics: '数据与数学',
  service_design: '公共设计', history_culture: '历史文化', language_arts: '叙事写作',
  media_literacy: '信息核验', economics: '经济启蒙', science: '科学探究', engineering: '工程设计', art: '艺术创作',
};
const STATUS: Record<string, string> = { published: '已发布', piloting: '已上架', archived: '已归档', draft: '编辑中', review: '待检查' };

export function TemplateLibraryCard({ template, onOpen, onDelete, onSaved, onRestore, restoring, restoreDisabled }: {
  template: AdminProjectTemplate; onOpen(): void; onDelete(): void; onSaved(): void;
  onRestore(): void; restoring: boolean; restoreDisabled: boolean;
}) {
  const available = template.status === 'published' || template.status === 'piloting';
  const schedule = template.lessonCount && template.lessonMinutes
    ? `${template.lessonCount} 课时 · 每课 ${template.lessonMinutes} 分钟` : '课时安排待配置';
  const age = template.ageRange && /\d/.test(template.ageRange) ? `${template.ageRange.replace(/岁$/, '')} 岁` : template.ageRange;
  return <article className={styles.card} data-status={template.status}>
    <div className={styles.topline}>
      <span className={styles.category}>{DOMAINS[template.domain ?? ''] ?? template.domain ?? '跨学科探究'}</span>
      <span className={available ? styles.available : styles.status}>{STATUS[template.status] ?? '状态待确认'}</span>
    </div>
    <div className={styles.heading}>
      <VisualAsset assetId={template.iconAssetId ?? 'subject-interdisciplinary-v1'} size={40} />
      <h2 className={styles.title}><button type="button" onClick={onOpen}>{template.title}</button></h2>
    </div>
    <p className={styles.summary}>{template.summary || '打开课程查看学习任务与成果要求。'}</p>
    <div className={styles.facts}><span>{schedule}</span>{age ? <span>{age}</span> : null}</div>
    <footer className={styles.footer}>
      {template.status === 'archived'
        ? <button type="button" className={styles.open} disabled={restoreDisabled} onClick={onRestore}>{restoring ? '正在恢复并核对…' : '恢复并编辑'} <span aria-hidden="true">↗</span></button>
        : <button type="button" className={styles.open} onClick={onOpen}>查看课程 <span aria-hidden="true">↗</span></button>}
      <details className={styles.actions}>
        <summary aria-label={`${template.title}的更多设置`}>···</summary>
        <div className={styles.menu}>
          {template.status === 'archived' && <button type="button" className={styles.open} onClick={onOpen}>查看归档内容</button>}
          <VisualSelector owner={{ kind: 'template', id: template.id }} usage="icon" label="主题图标" onSaved={onSaved} />
          <VisualSelector owner={{ kind: 'template', id: template.id }} usage="cover" label="主题封面" onSaved={onSaved} />
          {template.latestPublishedVersionId ? <VisualSelector owner={{ kind: 'template-version', id: template.latestPublishedVersionId }} usage="icon" label="版本图标" onSaved={onSaved} /> : null}
          {template.status !== 'archived' && <button type="button" className={styles.remove} onClick={onDelete}>移除课程</button>}
        </div>
      </details>
    </footer>
  </article>;
}
