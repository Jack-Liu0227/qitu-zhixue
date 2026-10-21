'use client';

import { useId, useState } from 'react';
import { AssistantGlyph, VisualAsset } from '@qitu/ui';
import type { TutorProjectContext, TutorReplyBlock } from '@qitu/contracts';

const descriptions: Record<string, string> = {
  '从生活现象开始': '从身边的小发现，找到值得追问的问题。',
  '我想动手做东西': '说说想做的作品，一起梳理可行的方向。',
  '还没有想法': '一起找找灵感，从一个简单的问题聊起。',
  '先了解挑战': '用一个日常例子，认识这个主题。',
  '聊聊我的观察': '从你已经注意到的现象开始追问。',
  '我想做什么作品': '把这个主题，变成你想完成的作品。',
};

/** Presentation only: choices and mentor identity come from the owned server session. */
export function ExplorationWelcome({ context, blocks, onSelectOption, disabled = false }: {
  context: TutorProjectContext;
  blocks: TutorReplyBlock[];
  onSelectOption: (label: string, text?: string) => void;
  disabled?: boolean;
}) {
  const headingId = useId();
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const meta = context.exploration;
  const template = Boolean(meta?.templateVersionId);
  const options = blocks.find(block => block.kind === 'options');
  const team = context.team;

  return <section className={`qitu-exploration-welcome${template ? ' is-template' : ''}`} aria-labelledby={headingId}>
    <div className="qitu-welcome-topline">
      <span className="qitu-welcome-label"><span aria-hidden="true" />{template ? '模板探索' : '自由探索'}</span>
      <span className="qitu-welcome-status">尚未创建项目</span>
    </div>
    <div className="qitu-welcome-hero">
      <div>
        <h2 id={headingId}>{template ? meta?.title : '让好奇，变成一次发现'}</h2>
        <p>{template ? '从你的观察开始，和导师一起找到想深入研究的问题。' : '一个生活中的发现，一个想动手做的作品，都可以成为起点。'}</p>
        {!template && meta?.title && meta.title !== '自由探索' ? <p className="qitu-welcome-topic">正在探索：{meta.title}</p> : null}
      </div>
      <div className="qitu-welcome-illustration" aria-hidden="true"><VisualAsset assetId="subject-interdisciplinary-v1" size={112} /></div>
    </div>
    <div className="qitu-welcome-mentor">
      <AssistantGlyph value={team?.assistantAvatar} size={34} />
      <div><strong>{team?.assistantName ?? '启途智学助手'}</strong><span>{team?.teamName ?? '陪你观察、提问，一起把想法聊清楚'}</span></div>
    </div>
    {template && meta?.handoff === 'pending' ? <p className="qitu-welcome-pending" role="status">模板导师配置待完善，可以先整理你的兴趣和问题。</p> : null}
    {meta?.drivingQuestion ? <div className="qitu-welcome-question"><span>这次一起研究</span><p>{meta.drivingQuestion}</p></div> : null}
    <div className="qitu-welcome-choice-heading"><h3>想从哪里开始？</h3><span>选一个方向，也可以说说自己的想法</span></div>
    <div className="qitu-welcome-choices">
      {options?.kind === 'options' ? options.items.map((item, index) => <button key={`${item.label}:${item.text}`} type="button"
        className="qitu-welcome-choice" disabled={disabled} onClick={() => onSelectOption(item.label, item.text)}>
        <span className="qitu-welcome-choice-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <span className="qitu-welcome-choice-copy"><strong>{item.label}</strong><span>{descriptions[item.label] ?? item.text}</span></span>
        <span className="qitu-welcome-choice-arrow" aria-hidden="true">↗</span>
      </button>) : null}
      {options?.kind === 'options' && options.allowOther ? <button type="button" className="qitu-welcome-choice is-other" disabled={disabled}
        aria-expanded={otherOpen} onClick={() => setOtherOpen(value => !value)}>
        <span className="qitu-welcome-choice-number" aria-hidden="true">＋</span>
        <span className="qitu-welcome-choice-copy"><strong>我有自己的想法</strong><span>直接聊聊你的发现、疑问或灵感。</span></span>
        <span className="qitu-welcome-choice-arrow" aria-hidden="true">↗</span>
      </button> : null}
    </div>
    {otherOpen ? <form className="qitu-welcome-other" onSubmit={event => {
      event.preventDefault();
      if (!disabled && otherText.trim()) onSelectOption('其他', otherText.trim());
    }}>
      <label htmlFor={`${headingId}-idea`}>你的想法</label>
      <textarea autoFocus id={`${headingId}-idea`} value={otherText} disabled={disabled} maxLength={1200} rows={2}
        placeholder="比如：我发现雨后会有彩虹，想知道它是怎么形成的……" onChange={event => setOtherText(event.target.value)} />
      <button type="submit" className="qitu-button qitu-button-primary" disabled={disabled || !otherText.trim()}>发送想法</button>
    </form> : null}
    <footer className="qitu-welcome-footer">
      <ol aria-label="探索过程"><li className="is-current">聊聊兴趣</li><li>一起定题</li><li>确认项目</li></ol>
      <p>确认后才创建项目，理论过关后再进入实践。</p>
    </footer>
  </section>;
}
