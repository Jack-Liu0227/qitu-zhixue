import { BadRequestException } from '@nestjs/common';

export const INTAKE_ASSISTANT_ID = 'qitu-intake-assistant';

export function assertDomainLeader(assistantId: string): void {
  if (assistantId === INTAKE_ASSISTANT_ID) throw new BadRequestException({
    code: 'INTAKE_LEADER_FORBIDDEN', message: '启途智学助手只负责兴趣接待，请选择领域导师担任团队负责人。',
  });
}

export function assertFormalTeachingAssistant(assistantId: string): void {
  if (assistantId === INTAKE_ASSISTANT_ID) throw new BadRequestException({
    code: 'INTAKE_FORMAL_TEACHING_FORBIDDEN', message: '启途智学助手不承担正式课时教学或课堂协作。',
  });
}
