'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AccountRegistrationPolicy,
  AccountRegistrationRequest,
  AccountRegistrationResult,
} from '@qitu/contracts';
import { businessIdempotencyKey, businessRequest, BusinessApiError } from '@qitu/api-client';
import { RegistrationPhoneFields } from './RegistrationPhoneFields';
import styles from './registration.module.css';
import auth from './auth.module.css';
import { RegistrationPassword } from './RegistrationPassword';
import { Icon } from '../home/icons';

type PolicyState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: AccountRegistrationPolicy };
export function AccountRegistration({
  onComplete,
  onCancel,
  onBusyChange,
}: {
  onComplete: (result: AccountRegistrationResult) => void;
  onCancel: () => void;
  onBusyChange: (value: boolean) => void;
}) {
  const [role, setRole] = useState<'student' | 'parent'>('student');
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [policy, setPolicy] = useState<PolicyState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0),
    [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [agreed, setAgreed] = useState(false),
    [ageConsent, setAgeConsent] = useState(false);
  const key = useRef<string | null>(null),
    pending = useRef(false),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPolicy({ kind: 'loading' });
    setAgreed(false);
    key.current = null;
    void businessRequest<AccountRegistrationPolicy>('public/account-registration', {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPolicy({ kind: 'ready', value });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setPolicy({
            kind: 'error',
            message: cause instanceof Error ? cause.message : '注册说明读取失败',
          });
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || offline || policy.kind !== 'ready' || !agreed || !ageConsent) return;
    const fields = new FormData(event.currentTarget),
      read = (name: string) => String(fields.get(name) ?? '');
    if (read('password') !== read('confirm')) {
      setError('两次输入的密码不一致，请重新检查');
      return;
    }
    if (
      method === 'phone' &&
      (!policy.value.phoneRegistration.available ||
        !read('challengeId') ||
        !/^\d{6}$/.test(read('code')))
    ) {
      setError('请先获取短信并填写六位验证码');
      return;
    }
    const body: AccountRegistrationRequest = {
      displayName: read('displayName'),
      role,
      password: read('password'),
      ...(method === 'email'
        ? { method, email: read('email') }
        : { method, phone: read('phone'), challengeId: read('challengeId'), code: read('code') }),
      policyVersion: policy.value.version,
      acceptedTerms: true,
      ageConsent: true,
    };
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      key.current ??= businessIdempotencyKey();
      const result = await businessRequest<AccountRegistrationResult>(
        'public/account-registration',
        { method: 'POST', key: key.current, body },
      );
      form.current?.reset();
      key.current = null;
      onComplete(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '注册未完成，请重试');
      if (cause instanceof BusinessApiError && cause.code === 'ACCOUNT_REGISTRATION_POLICY_CHANGED')
        setRetry((value) => value + 1);
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  const phoneUnavailable =
    method === 'phone' && policy.kind === 'ready' && !policy.value.phoneRegistration.available;
  return (
    <div className={styles.registration}>
      {offline && (
        <p role="status" className={styles.error}>
          当前已断网，请恢复连接后继续注册。
        </p>
      )}
      {policy.kind === 'loading' && (
        <p className={styles.loading} role="status">
          正在读取注册说明…
        </p>
      )}
      {policy.kind === 'error' && (
        <div className={styles.retry} role="alert">
          <p>{policy.message}</p>
          <button type="button" disabled={offline} onClick={() => setRetry((value) => value + 1)}>
            重新读取注册说明
          </button>
        </div>
      )}
      <form
        ref={form}
        onSubmit={submit}
        aria-busy={busy}
        onChange={() => {
          if (!pending.current) {
            key.current = null;
            setError('');
          }
        }}
      >
        <fieldset disabled={busy || offline || policy.kind !== 'ready'}>
          <div className={styles.roles} role="group" aria-label="选择注册身份">
            {(['student', 'parent'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={role === value}
                onClick={() => {
                  setRole(value);
                  key.current = null;
                  setError('');
                }}
              >
                <span className={styles.roleTitle}>
                  <Icon name={value === 'student' ? 'user' : 'group'} width={17} height={17} />
                  <strong>{value === 'student' ? '我是学生' : '我是家长'}</strong>
                  <span className={styles.roleCheck} aria-hidden="true">
                    ✓
                  </span>
                </span>
                <span className={styles.roleDescription}>
                  {value === 'student' ? '探索问题，完成自己的项目' : '关注孩子，陪伴每一次成长'}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.methods} role="group" aria-label="注册方式">
            {(['email', 'phone'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                onClick={() => {
                  setMethod(value);
                  key.current = null;
                  setError('');
                }}
              >
                <span>{value === 'email' ? '邮箱注册' : '手机号注册'}</span>
                {value === 'phone' &&
                  policy.kind === 'ready' &&
                  !policy.value.phoneRegistration.available && (
                    <span className={styles.badge}>待开通</span>
                  )}
              </button>
            ))}
          </div>
          {phoneUnavailable && (
            <div className={styles.pending} role="status">
              <span className={styles.pendingIcon}>
                <Icon name="phone" width={24} height={24} />
              </span>
              <h2>手机号注册即将开放</h2>
              <p>目前可以使用邮箱创建账号，开始你的学习与陪伴。</p>
              <button
                type="button"
                onClick={() => {
                  setMethod('email');
                  key.current = null;
                }}
              >
                使用邮箱注册
                <Icon name="arrowRight" width={16} height={16} />
              </button>
            </div>
          )}
          <div className={styles.details} hidden={phoneUnavailable}>
            <section className={styles.account} aria-label="个人账号信息">
              <label className={auth.field}>
                你的称呼
                <input
                  name="displayName"
                  required
                  maxLength={60}
                  autoComplete="nickname"
                  placeholder="昵称即可，不必填写真实姓名"
                />
              </label>
              {method === 'phone' && policy.kind === 'ready' ? (
                <RegistrationPhoneFields
                  key={policy.value.version}
                  policy={policy.value}
                  onPolicyChanged={() => setRetry((value) => value + 1)}
                />
              ) : (
                <label className={auth.field}>
                  登录邮箱
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={150}
                    autoComplete="email"
                    autoCapitalize="none"
                    placeholder="填写你可以使用的邮箱"
                  />
                </label>
              )}
              <div className={styles.passwords}>
                <RegistrationPassword />
                <RegistrationPassword confirm />
              </div>
            </section>
            {role === 'parent' && (
              <p className={styles.roleHint}>
                注册后进入家长端。完成监护关系核验后，即可查看已授权孩子的学习进展。
              </p>
            )}
            {policy.kind === 'ready' && (
              <section className={styles.policy} aria-label="注册说明">
                <details>
                  <summary>账号与隐私说明</summary>
                  <p>{policy.value.notice}</p>
                </details>
                {(
                  [
                    ['服务说明', policy.value.termsText],
                    ['隐私说明', policy.value.privacyText],
                  ] as const
                ).map(
                  ([label, value]) =>
                    value && (
                      <details key={label}>
                        <summary>{label}</summary>
                        <p>{value}</p>
                      </details>
                    ),
                )}
                {policy.value.operatorName && <p>服务提供方：{policy.value.operatorName}</p>}
                {policy.value.supportEmail && (
                  <a href={`mailto:${policy.value.supportEmail}`}>联系平台客服</a>
                )}
              </section>
            )}
            <div className={styles.consents}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  required
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                我已阅读并同意账号、服务与隐私说明。
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  required
                  checked={ageConsent}
                  onChange={(event) => setAgeConsent(event.target.checked)}
                />
                我已成年，或已取得监护人同意使用本服务。
              </label>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button
              className={auth.primary}
              type="submit"
              disabled={
                !agreed ||
                !ageConsent ||
                (method === 'phone' &&
                  (policy.kind !== 'ready' || !policy.value.phoneRegistration.available))
              }
            >
              {busy ? '正在创建…' : '创建账号'}
              <Icon name="arrowRight" width={18} height={18} />
            </button>
          </div>
          <p className={auth.hint}>
            教师与管理员账号由平台开通。需要帮助？<a href="/contact">联系平台</a>
          </p>
        </fieldset>
      </form>
      <div className={auth.alternate}>
        <span>已有账号？</span>
        <button type="button" disabled={busy} onClick={onCancel}>
          返回登录
        </button>
      </div>
    </div>
  );
}
