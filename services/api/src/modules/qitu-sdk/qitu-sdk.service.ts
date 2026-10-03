import { Injectable } from '@nestjs/common';
import { createQituSDK } from '@qitu/ai-client';
import type { CurrentUser } from '@qitu/contracts';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { ProjectLifecycleService } from '../projects/project-lifecycle.service';
import { GrowthService } from '../growth/growth.service';

@Injectable()
export class QituSDKFactory {
  constructor(private readonly mastery: MasteryDomainService, private readonly projects: ProjectLifecycleService, private readonly growth: GrowthService) {}

  create<Input, Result>(actor: CurrentUser, scope: { studentId: string; projectId: string | null }, runner: (input: Input) => Promise<Result>) {
    return createQituSDK<Input, Result, Awaited<ReturnType<GrowthService['getMasteryProfile']>>>(scope, {
      mastery: this.mastery.forActor(actor),
      agent: { run: async (input, bound) => {
        // Resolve authorization on every action, not only when constructing the facade.
        await this.mastery.forActor(actor).getCurrent({ studentId: bound.studentId, validAt: null, knownAt: null });
        const result = await runner(input);
        if (bound.projectId) await this.mastery.reassessProjectEvidence(actor, bound.studentId, bound.projectId);
        return result;
      } },
      project: {
        canAdvance: (bound) => {
          if (!bound.projectId) throw new Error('SDK_PROJECT_REQUIRED');
          return this.projects.canAdvance(actor, bound.studentId, bound.projectId);
        },
        advance: (bound, key) => {
          if (!bound.projectId) throw new Error('SDK_PROJECT_REQUIRED');
          return this.projects.advance(actor, bound.studentId, bound.projectId, key);
        },
      },
      profile: { get: (bound) => this.growth.getMasteryProfile(actor, bound.studentId) },
    });
  }
}
