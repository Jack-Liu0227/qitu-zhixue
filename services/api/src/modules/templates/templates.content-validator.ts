import { BadRequestException } from '@nestjs/common';
import { validateProjectTemplateSpec } from '@qitu/contracts';
import type { TemplateStage } from './templates.types';

/** Generic legacy content stays supported; teaching content has one contract. */
export function assertTemplateTeachingContent(content: Record<string, unknown>, stages: readonly TemplateStage[]): void {
  if ('curriculum' in content || 'theme' in content) {
    throw new BadRequestException({ code: 'TEMPLATE_INPUT_INVALID', message: 'Theme and curriculum must belong to content.pbl' });
  }
  if (!Object.prototype.hasOwnProperty.call(content, 'pbl')) {
    return;
  }
  const result = validateProjectTemplateSpec(content.pbl);
  if (!result.valid) {
    throw new BadRequestException({ code: 'TEMPLATE_INPUT_INVALID', message: 'Invalid PBL teaching contract', errors: result.errors });
  }
  const expected = ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'];
  if (stages.length !== expected.length || stages.some((stage, index) => stage.id !== expected[index])) {
    throw new BadRequestException({ code: 'TEMPLATE_INPUT_INVALID', message: 'PBL stages must match the teaching contract phases' });
  }
}
