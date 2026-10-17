'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@qitu/api-client';
import { inspirationDataSource } from '../data';
import type { InspirationDataSource } from '../data';
import type { InspirationTemplate } from '../types';
import { createInspirationIdempotencyKey } from '../idempotency';

interface RecommendedExplorationButtonProps {
  template: InspirationTemplate;
  dataSource?: InspirationDataSource;
  className?: string;
  disabled?: boolean;
}

/** Creates the server-owned exploration before entering Tutor. */
export function RecommendedExplorationButton({
  template,
  dataSource = inspirationDataSource,
  className = 'qitu-button',
  disabled = false,
}: RecommendedExplorationButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const unavailable = template.templateVersionId === null;

  async function start() {
    if (pending || unavailable) return;
    const templateVersionId = template.templateVersionId;
    if (templateVersionId === null) return;
    setPending(true);
    setError(null);
    keyRef.current ??= createInspirationIdempotencyKey();
    try {
      const exploration = await dataSource.createRecommendedExploration(
        { source: 'recommended', templateVersionId },
        keyRef.current,
      );
      router.push(`/tutor?explorationId=${encodeURIComponent(exploration.id)}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError('当前账号没有权限开始这个推荐探索。');
      } else if (cause instanceof ApiError && cause.status === 0) {
        setError('网络已断开，恢复网络后再试。');
      } else {
        setError(cause instanceof Error ? cause.message : '暂时无法开始推荐探索，请重试。');
      }
      setPending(false);
    }
  }

  return (
    <div className="qitu-inspiration-start-action">
      <button
        type="button"
        className={className}
        onClick={() => { void start(); }}
        disabled={pending || unavailable || disabled}
        aria-disabled={pending || unavailable || disabled}
        title={unavailable ? '该推荐项目尚无已发布模板版本' : disabled ? '当前网络不可用' : undefined}
      >
        {pending ? '正在接入团队…' : unavailable ? '暂不可开始' : '💬 与AI搭档开始'}
      </button>
      {unavailable ? <p className="qitu-inspiration-action-hint">该推荐项目尚无已发布版本，暂不能建立团队探索。</p> : null}
      {disabled && !unavailable ? <p className="qitu-inspiration-action-hint">当前网络不可用，恢复网络后再开始。</p> : null}
      {error ? <p className="qitu-inspiration-action-error" role="alert">{error}</p> : null}
    </div>
  );
}
