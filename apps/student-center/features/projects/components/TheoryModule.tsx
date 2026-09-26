import { SectionCard } from '@qitu/ui';
import type { TheoryMaterial } from '../types';

export interface TheoryModuleProps {
  material: TheoryMaterial;
}

/** 理论学习材料（只读）；不渲染任何原始对话/语音。 */
export function TheoryModule({ material }: TheoryModuleProps) {
  return (
    <SectionCard title={material.title}>
      <div className="qitu-theory-module">
        {material.sections.map((section) => (
          <section key={section.heading}>
            <h4>{section.heading}</h4>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    </SectionCard>
  );
}
