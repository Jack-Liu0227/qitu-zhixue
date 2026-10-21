'use client';

import { SectionCard } from '@qitu/ui';
import type { TheoryMaterial } from '../types';
import { MarkdownMathView } from '../../tutor/components/MarkdownMathView';

export interface TheoryModuleProps { material: TheoryMaterial }

/** Display server-provided plan context; interactive experiments belong to Tutor. */
export function TheoryModule({ material }: TheoryModuleProps) {
  return (
    <SectionCard title={material.title}>
      <div className="qitu-theory-module">
        {material.sections.map((section) => (
          <section key={section.heading}>
            <h4>{section.heading}</h4>
            <MarkdownMathView content={section.body} />
          </section>
        ))}
      </div>
    </SectionCard>
  );
}
