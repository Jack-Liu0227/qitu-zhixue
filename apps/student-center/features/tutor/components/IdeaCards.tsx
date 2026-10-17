'use client';

import { useState } from 'react';
import type { TutorIdeaCard } from '@qitu/contracts';

export function IdeaCards({
  cards,
  disabled,
  confirming,
  onCreate,
}: {
  cards: TutorIdeaCard[];
  disabled: boolean;
  confirming: boolean;
  onCreate: (goal: string, interest: string, templateVersionId: string) => void;
}) {
  if (cards.length === 0) {
    return <p className="qitu-tutor-muted" role="status">当前没有可确认的项目想法。</p>;
  }

  return (
    <section className="qitu-idea-cards" aria-label="项目想法">
      <header>
        <strong>启途智学助手整理了这些方向</strong>
        <span>选择并确认后才会创建项目</span>
      </header>
      <div className="qitu-idea-card-list">
        {cards.map((card) => (
          <IdeaCard
            key={card.ideaId}
            card={card}
            disabled={disabled}
            confirming={confirming}
            onCreate={onCreate}
          />
        ))}
      </div>
    </section>
  );
}

function IdeaCard({
  card,
  disabled,
  confirming,
  onCreate,
}: {
  card: TutorIdeaCard;
  disabled: boolean;
  confirming: boolean;
  onCreate: (goal: string, interest: string, templateVersionId: string) => void;
}) {
  const [goal, setGoal] = useState(card.suggestedGoal);
  const [interest, setInterest] = useState(card.suggestedInterest);
  const hasTemplateVersion = typeof card.templateVersionId === 'string' && card.templateVersionId.trim().length > 0;

  return (
    <article className="qitu-idea-card">
      <div className="qitu-idea-card-heading">
        <div>
          <h3>{card.title}</h3>
          <p>{card.description}</p>
        </div>
        <span className="qitu-idea-weeks">{card.weeks} 周</span>
      </div>
      <dl>
        <div><dt>为什么适合</dt><dd>{card.rationale}</dd></div>
        <div><dt>将唤醒的团队</dt><dd>{card.teamName ?? '项目团队将由服务端绑定'}</dd></div>
      </dl>
      <div className="qitu-idea-card-fields">
        <label>
          学习目标
          <textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={120} rows={2} disabled={disabled || confirming} />
        </label>
        <label>
          兴趣方向
          <input value={interest} onChange={(event) => setInterest(event.target.value)} maxLength={24} disabled={disabled || confirming} />
        </label>
      </div>
      <button
        type="button"
        className="qitu-button qitu-button-primary qitu-button-sm"
        disabled={disabled || confirming || !goal.trim() || !interest.trim() || !hasTemplateVersion}
        onClick={() => hasTemplateVersion && onCreate(goal, interest, card.templateVersionId)}
      >
        {confirming ? '正在创建并唤醒团队…' : '一键创建项目'}
      </button>
      {!hasTemplateVersion ? <p role="note">该想法缺少模板版本，无法立项，请让助手重新推荐。</p> : null}
    </article>
  );
}
