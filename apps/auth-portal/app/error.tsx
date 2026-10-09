'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Icon } from './home/icons';

/**
 * 路由级错误兜底（`/` 与 `/login` 共用）。
 *
 * 覆盖 AGENTS.md 的「error 状态」要求：给出原因说明、错误编号和两个明确出口
 * （原地重试 / 去登录），并且**不显示**任何异常原文与用户数据。
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[auth-portal] 页面渲染失败', error);
  }, [error]);

  return (
    <div className="home-page">
      <div className="home-orbs" aria-hidden="true">
        <span className="home-orb home-orb--primary" />
        <span className="home-orb home-orb--mint" />
      </div>

      <main className="portal-state" role="alert">
        <span className="portal-state-icon portal-state-icon--error" aria-hidden="true">
          <Icon name="bolt" size={26} />
        </span>
        <h1 className="portal-state-title">页面暂时打不开</h1>
        <p className="portal-state-text">
          可能是网络波动，也可能是服务正在升级。你的账号信息和已提交内容都没有丢失，
          可以重新加载一次；如果仍然失败，请从统一登录入口进入。
        </p>
        {error.digest ? (
          <code className="portal-state-code">错误编号：{error.digest}</code>
        ) : null}
        <div className="portal-state-actions">
          <button type="button" className="home-btn home-btn--primary" onClick={reset}>
            重新加载
          </button>
          <Link className="home-btn home-btn--outline" href="/login">
            前往统一登录
          </Link>
        </div>
      </main>
    </div>
  );
}
