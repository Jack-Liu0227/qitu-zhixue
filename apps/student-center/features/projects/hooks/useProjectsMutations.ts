'use client';

import { useCallback, useRef, useState } from 'react';
import { projectsDataSource } from '../data';
import { createIdempotencyKey } from '../lib/idempotency';
import { toProjectsError } from '../lib/loadable';
import type { ProjectsError } from '../lib/loadable';
import type {
  PresignRequest,
  PresignResponse,
  ReflectionInput,
  TaskSubmission,
  TheoryAnswer,
  TheoryCheckResult,
} from '../types';

/**
 * 写操作 hook 基座。
 *
 * idempotency key 在首次调用时生成、重试/双击复用，成功后丢弃——
 * 保证双击只产生一条服务端记录（验收 11）。
 */
function useIdempotentMutation<TArgs extends unknown[], TResult>(
  run: (idempotencyKey: string, ...args: TArgs) => Promise<TResult>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ProjectsError | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;

  const mutate = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      // 双击保护：同一提交在飞行中时直接忽略第二次点击。
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      if (keyRef.current === null) keyRef.current = createIdempotencyKey();
      setPending(true);
      setError(null);
      try {
        const response = await runRef.current(keyRef.current, ...args);
        keyRef.current = null;
        setResult(response);
        return response;
      } catch (caught) {
        setError(toProjectsError(caught));
        return null;
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { mutate, pending, error, result };
}

export function useTheorySubmit(projectId: string) {
  const run = useCallback(
    (idempotencyKey: string, answers: TheoryAnswer[]) =>
      projectsDataSource.submitTheoryCheck(projectId, answers, idempotencyKey),
    [projectId],
  );
  return useIdempotentMutation<[TheoryAnswer[]], TheoryCheckResult>(run);
}

export function useTaskCompletion(taskId: string) {
  const run = useCallback(
    (idempotencyKey: string) => projectsDataSource.completeTask(taskId, idempotencyKey),
    [taskId],
  );
  return useIdempotentMutation<[], { taskId: string; status: TheoryCheckResult['nextStage'] }>(
    run,
  );
}

export function useTaskSubmission(taskId: string) {
  const run = useCallback(
    (idempotencyKey: string, payload: TaskSubmission) =>
      projectsDataSource.submitTask(taskId, payload, idempotencyKey),
    [taskId],
  );
  return useIdempotentMutation<[TaskSubmission], { submissionId: string }>(run);
}

export function useReflectionSubmit(projectId: string) {
  const run = useCallback(
    (idempotencyKey: string, payload: ReflectionInput) =>
      projectsDataSource.submitReflection(projectId, payload, idempotencyKey),
    [projectId],
  );
  return useIdempotentMutation<[ReflectionInput], { reflectionId: string }>(run);
}

export function useArtifactPresign() {
  const run = useCallback(
    (idempotencyKey: string, payload: PresignRequest) =>
      projectsDataSource.presignArtifact(payload, idempotencyKey),
    [],
  );
  return useIdempotentMutation<[PresignRequest], PresignResponse>(run);
}

/**
 * 列表式任务完成：为每个 taskId 各自维护幂等键，双击同一任务只落一条。
 * 供实践屏 / 详情屏的任务列表使用。
 */
export function useTaskCompleteList() {
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<ProjectsError | null>(null);
  const keysRef = useRef<Map<string, string>>(new Map());
  // 同步双击保护：同一 tick 内的第二次点击在重渲染前即被拦截。
  const inFlightRef = useRef(false);

  const complete = useCallback(
    async (taskId: string): Promise<{ taskId: string } | null> => {
      if (inFlightRef.current) return null;
      if (pendingTaskId) return null;
      inFlightRef.current = true;
      const keys = keysRef.current;
      const key = keys.get(taskId) ?? createIdempotencyKey();
      keys.set(taskId, key);
      setPendingTaskId(taskId);
      setError(null);
      try {
        const response = await projectsDataSource.completeTask(taskId, key);
        keys.delete(taskId);
        return response;
      } catch (caught) {
        setError(toProjectsError(caught));
        return null;
      } finally {
        inFlightRef.current = false;
        setPendingTaskId(null);
      }
    },
    [pendingTaskId],
  );

  return { complete, pendingTaskId, error };
}
