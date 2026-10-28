'use client';
import { useEffect, useRef, useState } from 'react';
import {
  normalizeRegistrationPhone,
  type AccountRegistrationPolicy,
  type RegistrationSmsReceipt,
} from '@qitu/contracts';
import { businessIdempotencyKey, businessRequest, BusinessApiError } from '@qitu/api-client';
import styles from './registration.module.css';
import auth from './auth.module.css';

export function RegistrationPhoneFields({
  policy,
  onPolicyChanged,
}: {
  policy: AccountRegistrationPolicy;
  onPolicyChanged: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState<RegistrationSmsReceipt | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ key: string; phone: string } | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  async function send() {
    const normalized = normalizeRegistrationPhone(phone);
    if (pending.current || !consent || remaining || !policy.phoneRegistration.available) return;
    if (!normalized) {
      setError('请填写中国大陆的 11 位手机号');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    if (request.current?.phone !== normalized)
      request.current = { key: businessIdempotencyKey(), phone: normalized };
    try {
      const value = await businessRequest<RegistrationSmsReceipt>(
        'public/account-registration/sms',
        {
          method: 'POST',
          key: request.current.key,
          body: { phone: normalized, policyVersion: policy.version, acceptedSmsTerms: true },
        },
      );
      if (generation.current !== current) return;
      setReceipt(value);
      setRemaining(value.retryAfterSeconds);
      request.current = null;
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : '验证码发送未完成，请重试');
        if (
          cause instanceof BusinessApiError &&
          cause.code === 'ACCOUNT_REGISTRATION_POLICY_CHANGED'
        )
          onPolicyChanged();
        if (cause instanceof BusinessApiError && cause.status > 0) {
          request.current = null;
          setRemaining(60);
        }
      }
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  }
  return (
    <div className={styles.phoneFields}>
      <p className={styles.hint} role="status">
        {policy.phoneRegistration.reason}
      </p>
      <label className={auth.field}>
        手机号
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={14}
          required
          value={phone}
          placeholder="11 位中国大陆手机号"
          disabled={busy || !policy.phoneRegistration.available}
          onChange={(event) => {
            setPhone(event.target.value);
            setReceipt(null);
            request.current = null;
            setError('');
          }}
        />
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={consent}
          disabled={!policy.phoneRegistration.available}
          onChange={(event) => setConsent(event.target.checked)}
        />
        同意将此手机号用于阿里云注册验证码发送。
      </label>
      <button
        className={styles.smsButton}
        type="button"
        onClick={() => void send()}
        disabled={busy || remaining > 0 || !consent || !policy.phoneRegistration.available}
      >
        {busy ? '正在发送…' : remaining ? `${remaining} 秒后可重发` : '获取验证码'}
      </button>
      {receipt && (
        <p className={styles.hint} role="status">
          验证码请求已提交，请查看手机短信，5 分钟内有效。
        </p>
      )}
      <input type="hidden" name="challengeId" value={receipt?.challengeId ?? ''} />
      <label className={auth.field}>
        短信验证码
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          required
          disabled={!receipt}
          placeholder="收到的 6 位验证码"
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
