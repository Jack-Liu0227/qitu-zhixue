import type { EvaluateMasteryInput, MasteryTimelinePort, ProjectStage } from '@qitu/contracts';

export interface QituSDKScope { studentId: string; projectId: string | null }
export interface QituProjectGate {
  allowed: boolean;
  stage: ProjectStage;
  nextStage: ProjectStage | null;
  reason: string;
}
export interface QituSDKPorts<Input, Result, Profile> {
  mastery: MasteryTimelinePort;
  agent: { run(input: Input, scope: Readonly<QituSDKScope>): Promise<Result> };
  project: {
    canAdvance(scope: Readonly<QituSDKScope>): Promise<QituProjectGate>;
    advance(scope: Readonly<QituSDKScope>, idempotencyKey: string): Promise<QituProjectGate>;
  };
  profile: { get(scope: Readonly<QituSDKScope>): Promise<Profile> };
}

/** Server composition only. All permissions and writes remain in the supplied domain ports. */
export function createQituSDK<Input, Result, Profile>(
  scope: QituSDKScope,
  ports: QituSDKPorts<Input, Result, Profile>,
) {
  if (!scope.studentId || !ports.mastery || !ports.agent?.run || !ports.project?.advance || !ports.project?.canAdvance || !ports.profile?.get) {
    throw new Error('SDK_PORT_NOT_CONFIGURED');
  }
  const bound = Object.freeze({ ...scope });
  function query<T extends object>(input: T) {
    if ('studentId' in input && input.studentId !== bound.studentId) throw new Error('SDK_SCOPE_MISMATCH');
    if ('projectId' in input && input.projectId !== bound.projectId) throw new Error('SDK_SCOPE_MISMATCH');
    return { ...input, studentId: bound.studentId };
  }
  return {
    scope: bound,
    mastery: {
      evaluate: (input: Omit<EvaluateMasteryInput, 'studentId' | 'projectId'>) => ports.mastery.evaluate({ ...query(input), projectId: bound.projectId } as EvaluateMasteryInput),
      getCurrent: (input: Omit<Parameters<MasteryTimelinePort['getCurrent']>[0], 'studentId'> = { validAt: null, knownAt: null }) => ports.mastery.getCurrent(query(input)),
      getTimeline: (input: Omit<Parameters<MasteryTimelinePort['getTimeline']>[0], 'studentId'>) => ports.mastery.getTimeline(query(input)),
      snapshot: (input: Omit<Parameters<MasteryTimelinePort['snapshot']>[0], 'studentId'>) => ports.mastery.snapshot(query(input)),
      checkThreshold: (input: Omit<Parameters<MasteryTimelinePort['checkThreshold']>[0], 'studentId'>) => ports.mastery.checkThreshold(query(input)),
      getRegressionAlerts: (input: Omit<Parameters<MasteryTimelinePort['getRegressionAlerts']>[0], 'studentId'> = {}) => ports.mastery.getRegressionAlerts(query(input)),
    },
    agent: { run: (input: Input) => ports.agent.run(input, bound) },
    project: {
      canAdvance: () => ports.project.canAdvance(bound),
      advance: (idempotencyKey: string) => {
        if (!idempotencyKey?.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
        return ports.project.advance(bound, idempotencyKey);
      },
    },
    profile: { get: () => ports.profile.get(bound) },
  };
}
