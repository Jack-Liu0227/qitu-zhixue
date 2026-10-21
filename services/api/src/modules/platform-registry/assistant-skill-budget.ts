import { BadRequestException } from '@nestjs/common';
import { assertRuntimeSkillBudget } from '@qitu/contracts';

export function assertAssistantSkillBudget(skills: readonly { content: string }[]): void {
  try { assertRuntimeSkillBudget(skills); }
  catch { throw new BadRequestException({ code: 'ASSISTANT_SKILL_BUDGET_EXCEEDED', message: '助手绑定的技能内容超过运行时预算，请按导师职责精简技能后再发布团队' }); }
}
