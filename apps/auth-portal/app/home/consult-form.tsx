'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import type { ConsultationIdentity, ConsultationReceipt } from '@qitu/contracts';

import { Icon } from './icons';

const IDENTITIES: ReadonlyArray<{ value: ConsultationIdentity; label: string; hint: string }> = [
  { value: 'student', label: '学生本人', hint: '想自己做一个项目' },
  { value: 'parent', label: '家长', hint: '为孩子了解研学路线' },
  { value: 'school', label: '学校 / 机构代表', hint: '想接入校本课程体系' },
];

const NAME_MAX = 40;
const MESSAGE_MAX = 500;
const MOBILE = /^1[3-9]\d{9}$/;
const LANDLINE = /^0\d{2,3}\d{7,8}$/;
const REQUEST_TIMEOUT_MS = 10_000;

type FieldName = 'name' | 'phone' | 'identity' | 'message';
type FieldErrors = Partial<Record<FieldName, string>>;
type Status = 'idle' | 'submitting' | 'success' | 'error';

interface ProblemBody {
  code?: string;
  message?: string;
  detail?: string;
  errors?: Array<{ path?: string; message?: string }>;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()（）·.]/g, '');
}

function validate(values: {
  name: string;
  phone: string;
  identity: ConsultationIdentity | '';
  message: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (values.name === '') {
    errors.name = '请填写您的姓名';
  } else if (values.name.length > NAME_MAX) {
    errors.name = `姓名不能超过 ${NAME_MAX} 个字符`;
  }
  const phone = normalizePhone(values.phone);
  if (phone === '') {
    errors.phone = '请填写联系电话';
  } else if (!MOBILE.test(phone) && !LANDLINE.test(phone)) {
    errors.phone = '请填写有效的手机号或座机号';
  }
  if (values.identity === '') {
    errors.identity = '请选择咨询身份';
  }
  if (values.message.length > MESSAGE_MAX) {
    errors.message = `留言不能超过 ${MESSAGE_MAX} 个字符`;
  }
  return errors;
}

/**
 * 幂等键：同一个表单实例复用同一个键，所以「超时后重试」不会产生两条线索。
 * 提交成功后才换键。
 *
 * 注意：站点可能部署在纯 HTTP 上，此时 `crypto.getRandomValues` 在浏览器里不可用，
 * 因此这里不能依赖 WebCrypto。键只用于服务端去重，不需要密码学强度。
 */
function makeIdempotencyKey(): string {
  return `consult-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function messageForError(status: number, body: ProblemBody | null): string {
  if (body?.code === 'CONSULTATION_INVALID') return body.message ?? '填写内容有误，请检查后重试。';
  if (body?.code === 'CONSULTATION_UNAVAILABLE' || status === 503) {
    return '咨询通道暂时不可用（服务端未连接数据库或正在维护），请稍后再试。';
  }
  if (status === 409) return '这次提交与上一次重复，请刷新页面后重新填写。';
  if (status === 429) return '提交过于频繁，请稍后再试。';
  if (status >= 500) return '服务器暂时无法处理，请稍后重试。';
  return body?.message ?? body?.detail ?? '提交失败，请稍后重试。';
}

export function ConsultationForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [identity, setIdentity] = useState<ConsultationIdentity | ''>('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  const [alert, setAlert] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ConsultationReceipt | null>(null);
  const [online, setOnline] = useState(true);
  const keyRef = useRef('');

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const reset = useCallback(() => {
    setName('');
    setPhone('');
    setIdentity('');
    setMessage('');
    setFieldErrors({});
    setAlert(null);
    setReceipt(null);
    setStatus('idle');
    keyRef.current = '';
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return;

    const values = {
      name: name.trim(),
      phone: phone.trim(),
      identity,
      message: message.trim(),
    };
    const issues = validate(values);
    setFieldErrors(issues);
    if (Object.keys(issues).length > 0) {
      setStatus('error');
      setAlert('请先修正标红的字段。');
      return;
    }
    if (navigator.onLine === false) {
      setStatus('error');
      setAlert('当前网络不可用，已保留你填写的内容，联网后可直接重试。');
      return;
    }

    if (keyRef.current === '') keyRef.current = makeIdempotencyKey();
    setStatus('submitting');
    setAlert(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/v1/public/consultations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': keyRef.current,
        },
        body: JSON.stringify({
          name: values.name,
          phone: values.phone,
          identity: values.identity,
          message: values.message,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => null)) as
        { data?: ConsultationReceipt } | ProblemBody | null;

      if (!response.ok) {
        const problem = body as ProblemBody | null;
        const nextFieldErrors: FieldErrors = {};
        for (const item of problem?.errors ?? []) {
          const path = item.path;
          if (path === 'name' || path === 'phone' || path === 'identity' || path === 'message') {
            nextFieldErrors[path] = item.message ?? '字段不合法';
          }
        }
        setFieldErrors(nextFieldErrors);
        setStatus('error');
        setAlert(messageForError(response.status, problem));
        return;
      }

      const data = (body as { data?: ConsultationReceipt } | null)?.data ?? null;
      if (data === null) {
        setStatus('error');
        setAlert('提交结果无法确认，请稍后重试（重复提交不会产生重复记录）。');
        return;
      }
      setReceipt(data);
      setStatus('success');
      keyRef.current = '';
      setName('');
      setPhone('');
      setIdentity('');
      setMessage('');
      setFieldErrors({});
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      setStatus('error');
      setAlert(
        aborted
          ? '提交超时，请检查网络后重试（重复提交不会产生重复记录）。'
          : '网络异常，未能提交，请检查网络后重试。',
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  if (status === 'success' && receipt !== null) {
    return (
      <div className="home-form-success" role="status">
        <span className="home-form-success-icon" aria-hidden="true">
          <Icon name="checkCircle" size={30} />
        </span>
        <h3>已成功收到您的预约！</h3>
        <p>
          咨询编号 <code>{receipt.id.slice(0, 8)}</code>
          ，提交时间 {receipt.createdAt.slice(0, 16).replace('T', ' ')}。 我们会在 1
          个工作日内通过您留下的电话联系，请留意来电。
        </p>
        <p className="home-form-success-note">
          出于隐私保护，我们不会在页面上回显您的姓名与电话；如需更正信息，请直接回复来电。
        </p>
        <div className="home-form-success-actions">
          <button type="button" className="home-btn home-btn--outline" onClick={reset}>
            再提交一条
          </button>
          <Link className="home-btn home-btn--primary" href="/login?next=%2Fstudent%2Ftoday">
            先去逛逛学生端
            <Icon name="arrowRight" size={18} />
          </Link>
        </div>
      </div>
    );
  }

  const disabled = status === 'submitting' || !online;

  return (
    <form className="home-consult-form" onSubmit={handleSubmit} noValidate>
      {!online ? (
        <p className="home-form-alert home-form-alert--offline" role="alert">
          <Icon name="sensors" size={18} />
          当前网络不可用，表单已暂停提交；恢复联网后可继续。
        </p>
      ) : null}

      {alert !== null ? (
        <p className="home-form-alert" role="alert">
          <Icon name="bolt" size={18} />
          {alert}
        </p>
      ) : null}

      <div className="home-field">
        <label className="home-field-label" htmlFor="consult-name">
          您的姓名 <span aria-hidden="true">*</span>
        </label>
        <input
          id="consult-name"
          className={`home-input${fieldErrors.name !== undefined ? ' is-invalid' : ''}`}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX}
          value={name}
          placeholder="例：李老师"
          aria-invalid={fieldErrors.name !== undefined}
          aria-describedby={fieldErrors.name !== undefined ? 'consult-name-error' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {fieldErrors.name !== undefined ? (
          <span className="home-field-error" id="consult-name-error">
            {fieldErrors.name}
          </span>
        ) : null}
      </div>

      <div className="home-field">
        <label className="home-field-label" htmlFor="consult-phone">
          联系电话 <span aria-hidden="true">*</span>
        </label>
        <input
          id="consult-phone"
          className={`home-input${fieldErrors.phone !== undefined ? ' is-invalid' : ''}`}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={24}
          value={phone}
          placeholder="手机号或座机号，用于回访"
          aria-invalid={fieldErrors.phone !== undefined}
          aria-describedby={fieldErrors.phone !== undefined ? 'consult-phone-error' : undefined}
          onChange={(event) => setPhone(event.target.value)}
        />
        {fieldErrors.phone !== undefined ? (
          <span className="home-field-error" id="consult-phone-error">
            {fieldErrors.phone}
          </span>
        ) : (
          <span className="home-field-hint">
            仅用于回访本次咨询，不会用于推送营销信息，也不会展示在公开页面上。
          </span>
        )}
      </div>

      <fieldset className="home-field home-fieldset">
        <legend className="home-field-label">
          您的咨询身份 <span aria-hidden="true">*</span>
        </legend>
        <div className="home-radio-grid">
          {IDENTITIES.map((option) => (
            <label
              key={option.value}
              className={`home-radio${identity === option.value ? ' is-checked' : ''}`}
            >
              <input
                type="radio"
                name="identity"
                value={option.value}
                checked={identity === option.value}
                onChange={() => setIdentity(option.value)}
              />
              <span className="home-radio-body">
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {fieldErrors.identity !== undefined ? (
          <span className="home-field-error">{fieldErrors.identity}</span>
        ) : null}
      </fieldset>

      <div className="home-field">
        <label className="home-field-label" htmlFor="consult-message">
          意向需求与研学留言
        </label>
        <textarea
          id="consult-message"
          className={`home-input home-textarea${fieldErrors.message !== undefined ? ' is-invalid' : ''}`}
          name="message"
          rows={4}
          maxLength={MESSAGE_MAX}
          value={message}
          placeholder="例：想了解 4 周 / 8 周的学习计划怎么安排，希望先做一个关于水质的项目。"
          aria-invalid={fieldErrors.message !== undefined}
          onChange={(event) => setMessage(event.target.value)}
        />
        <span className="home-field-hint home-field-hint--count">
          {message.length} / {MESSAGE_MAX}
        </span>
        {fieldErrors.message !== undefined ? (
          <span className="home-field-error">{fieldErrors.message}</span>
        ) : null}
      </div>

      <button type="submit" className="home-btn home-btn--primary home-submit" disabled={disabled}>
        {status === 'submitting' ? (
          <>
            <span className="home-spinner" aria-hidden="true" />
            正在提交…
          </>
        ) : (
          <>
            <Icon name="send" size={18} />
            提交预约
          </>
        )}
      </button>

      <p className="home-form-footnote">
        提交即表示同意我们仅将上述信息用于本次咨询回访。未成年人信息请由监护人代为填写。
      </p>
    </form>
  );
}
