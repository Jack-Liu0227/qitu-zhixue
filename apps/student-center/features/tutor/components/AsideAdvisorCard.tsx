'use client';

import React from 'react';
import { AssistantGlyph } from '@qitu/ui';
import { MarkdownMathView } from './MarkdownMathView';
import { EvidenceChip } from './EvidenceChip';

export interface AsideAdvisorCardProps {
  copilot: {
    id: string;
    name: string;
    role: string;
    avatar?: string;
  };
  targetPhase: 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';
  content: string;
  evidenceRef?: string;
  proposalRef?: string;
  lesson?: { index: number; title: string };
}

const PHASE_LABELS: Record<AsideAdvisorCardProps['targetPhase'], string> = {
  exploration: '现象与问题',
  concept_mastery: '概念理解',
  guided_practice: '实践探究',
  deliverable_review: '成果与反思',
};

export function AsideAdvisorCard({
  copilot,
  targetPhase,
  content,
  evidenceRef,
  lesson,
}: AsideAdvisorCardProps) {
  return (
    <aside
      style={{
        margin: '12px 0',
        padding: '14px 16px',
        backgroundColor: 'rgba(99, 102, 241, 0.05)',
        borderLeft: '4px solid #6366f1',
        borderRadius: '0 10px 10px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
      aria-label="导师协诊旁白"
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AssistantGlyph value={copilot.avatar} size={22} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--qitu-heading, #1e293b)' }}>
            {copilot.name}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '4px',
              backgroundColor: 'var(--qitu-primary-soft, #e0e7ff)',
              color: 'var(--qitu-primary, #4338ca)',
              fontWeight: 500,
            }}
          >
            {copilot.role}
          </span>
        </div>
        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
          {lesson ? `第 ${lesson.index} 课 · ${lesson.title}` : `协作提示 · ${PHASE_LABELS[targetPhase]}`}
        </span>
      </header>

      <div style={{ color: 'var(--qitu-text, #334155)', fontSize: '13.5px' }}>
        <MarkdownMathView content={content} />
      </div>

      {evidenceRef && (
        <footer style={{ marginTop: '4px' }}>
          <EvidenceChip reference={evidenceRef} />
        </footer>
      )}
    </aside>
  );
}
