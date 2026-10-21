'use client';

import styles from './TutorStream.module.css';

interface PblStageCardProps {
  phase: 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';
  title: string;
  teammateLabel?: string;
  summary: string;
  tags?: readonly string[];
  actionLabel?: string;
  onAction?: () => void;
}

export function PblStageCard({
  phase,
  title,
  teammateLabel,
  summary,
  tags,
  actionLabel,
  onAction,
}: PblStageCardProps) {
  return (
    <div className={styles.pblCard} data-phase={phase}>
      <header className={styles.pblCardHeader}>
        <div className={styles.pblCardBadgeGroup}>
          <span className={styles.pblPhasePill}>课时探究活动</span>
          {teammateLabel && (
            <span className={styles.pblTeammatePill}>{teammateLabel}</span>
          )}
        </div>
        <h4 className={styles.pblCardTitle}>{title}</h4>
      </header>
      <p className={styles.pblCardSummary}>{summary}</p>
      {tags && tags.length > 0 && (
        <div className={styles.pblCardTags}>
          {tags.map((t, idx) => (
            <span key={idx} className={styles.pblTag}>
              #{t}
            </span>
          ))}
        </div>
      )}
      {actionLabel && (
        <footer className={styles.pblCardFooter}>
          <button
            type="button"
            className={styles.pblActionButton}
            onClick={onAction}
          >
            {actionLabel} →
          </button>
        </footer>
      )}
    </div>
  );
}
