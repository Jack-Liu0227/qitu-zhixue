'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './invitation.module.css';

interface InvitationView {
  parentEmail: string;
  studentEmail: string;
  accepted: boolean;
  revision: number;
  operatorName: string;
  supportEmail: string;
  termsText: string;
  privacyText: string;
  refundText: string;
}

async function invitationRequest<T>(operation: 'inspect' | 'accept', body: unknown): Promise<T> {
  if (!navigator.onLine) throw new Error('当前已断网，请恢复连接后重试');
  const response = await fetch(`/api/v1/public/family-invitations/${operation}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    if (error && typeof error === 'object') {
      if ('detail' in error && typeof error.detail === 'string') throw new Error(error.detail);
      if ('message' in error && typeof error.message === 'string') throw new Error(error.message);
    }
    throw new Error('邀请暂时无法处理，请重试或联系平台');
  }
  const result: { data: T } = await response.json();
  return result.data;
}

export function FamilyInvitation() {
  const [token, setToken] = useState('');
  const [view, setView] = useState<InvitationView | null>(null);
  const [parentPassword, setParentPassword] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const identity = useRef(0);
  const initialToken = useRef<string | null>(null);
  async function inspect(value: string) {
    const request = ++identity.current;
    setBusy(true);
    setError('');
    setView(null);
    try {
      const info = await invitationRequest<InvitationView>('inspect', { token: value });
      if (request === identity.current) setView(info);
    } catch (e) {
      if (request === identity.current) setError(e instanceof Error ? e.message : '邀请读取失败');
    } finally {
      if (request === identity.current) setBusy(false);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get('invite') ?? initialToken.current;
    initialToken.current = value;
    if (value) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setToken(value);
      void inspect(value);
    }
    return () => {
      ++identity.current;
    };
  }, []);
  return (
    <details className={styles.invitation} open={Boolean(token)}>
      <summary>受邀开通家庭账号</summary>
      {done ? (
        <p className={styles.success} role="status">
          家庭账号已开通。请在下方选择家长身份，使用 {done} 和刚设置的密码登录；学生使用独立账号。
        </p>
      ) : (
        <>
          {!view && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void inspect(token);
              }}
            >
              <label>
                邀请凭据
                <input
                  required
                  value={token}
                  maxLength={200}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴邀请链接中的凭据"
                  autoComplete="off"
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? '正在读取…' : '读取邀请'}
              </button>
            </form>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {view &&
            (view.accepted ? (
              <p>此邀请已完成开通，请使用已有账号登录。</p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  void invitationRequest<{ parentEmail: string }>('accept', {
                    token,
                    parentPassword,
                    studentPassword,
                    policyRevision: view.revision,
                    guardianConsent: consent,
                  })
                    .then((r) => {
                      setDone(r.parentEmail);
                      setParentPassword('');
                      setStudentPassword('');
                    })
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : '开通失败，请重试'),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                <p>
                  家长账号 {view.parentEmail}
                  <br />
                  学生账号 {view.studentEmail}
                </p>
                <label>
                  家长密码，至少 12 位
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={parentPassword}
                    onChange={(e) => setParentPassword(e.target.value)}
                  />
                </label>
                <label>
                  学生密码，至少 12 位
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={studentPassword}
                    onChange={(e) => setStudentPassword(e.target.value)}
                  />
                </label>
                {[
                  ['服务条款', view.termsText],
                  ['隐私与未成年人数据说明', view.privacyText],
                  ['退款规则', view.refundText],
                ].map(([label, content]) => (
                  <details key={label}>
                    <summary>{label}</summary>
                    <p className={styles.terms}>{content}</p>
                  </details>
                ))}
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    required
                  />
                  我已阅读并同意服务与隐私规则，确认我是受邀学生的监护人，同意按说明处理学习服务所需的数据。
                </label>
                <p>
                  服务提供方 {view.operatorName} · {view.supportEmail}
                </p>
                <button type="submit" disabled={busy || !consent}>
                  {busy ? '正在开通…' : '确认并开通家庭账号'}
                </button>
              </form>
            ))}
        </>
      )}
    </details>
  );
}
