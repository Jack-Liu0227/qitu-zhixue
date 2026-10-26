'use client';
import { useState } from 'react';
import { businessRequest } from '@qitu/api-client';
import type { BusinessAction } from './BusinessWorkspace';
import styles from './business.module.css';

export function FamilyInvitationForm({
  disabled,
  act,
}: {
  disabled: boolean;
  act: BusinessAction;
}) {
  const [parentName, setParentName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [invitation, setInvitation] = useState<{ link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const body = { parentName, parentEmail, studentName, studentEmail };
        void act(`invite:${JSON.stringify(body)}`, async (key) => {
          const result = await businessRequest<{ token: string; expiresAt: string }>(
            'admin/business/invitations',
            { method: 'POST', key, body },
          );
          setInvitation({
            link: `${window.location.origin}/login#invite=${encodeURIComponent(result.token)}`,
            expiresAt: result.expiresAt,
          });
          setCopied(false);
        });
      }}
    >
      <div>
        <h2>邀请一个家庭开始体验</h2>
        <p className={styles.note}>
          家长自行设置双方密码、阅读服务条款并确认监护人授权。完成开通后再购买课程。
        </p>
      </div>
      <div className={styles.columns}>
        <label className={styles.field}>
          家长称呼
          <input
            required
            maxLength={60}
            value={parentName}
            onChange={(e) => setParentName(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          家长登录邮箱
          <input
            required
            type="email"
            maxLength={150}
            value={parentEmail}
            onChange={(e) => setParentEmail(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.columns}>
        <label className={styles.field}>
          学生称呼
          <input
            required
            maxLength={60}
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          学生登录邮箱
          <input
            required
            type="email"
            maxLength={150}
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.formFooter}>
        <p>链接有效期 72 小时，请通过已核实的家长联系方式交付。</p>
        <button className={styles.primary} disabled={disabled} type="submit">
          生成家庭邀请
        </button>
      </div>
      {invitation && (
        <div className={styles.notice}>
          <label className={styles.field}>
            家庭开通链接
            <input readOnly value={invitation.link} onFocus={(e) => e.target.select()} />
          </label>
          <p>
            有效至 {new Date(invitation.expiresAt).toLocaleString('zh-CN')}
            。请妥善保管，不在公开渠道分享。
          </p>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(invitation.link)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? '已复制' : '复制邀请链接'}
          </button>
        </div>
      )}
    </form>
  );
}
