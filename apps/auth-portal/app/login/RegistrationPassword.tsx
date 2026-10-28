'use client';
import { useState } from 'react';
import styles from './auth.module.css';

export function RegistrationPassword({ confirm = false }: { confirm?: boolean }) {
  const [visible, setVisible] = useState(false);
  const label = confirm ? '确认密码' : '设置密码';
  const id = confirm ? 'registration-confirm' : 'registration-password';
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <span className={styles.password}>
        <input
          id={id}
          name={confirm ? 'confirm' : 'password'}
          type={visible ? 'text' : 'password'}
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          placeholder={confirm ? '再次输入密码' : '至少 12 位字符'}
        />
        <button
          type="button"
          aria-label={`${visible ? '隐藏' : '显示'}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? '隐藏' : '显示'}
        </button>
      </span>
    </div>
  );
}
