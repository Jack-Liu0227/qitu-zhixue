'use client';
import { useState, type FormEvent } from 'react';
import type {
  BusinessDashboard,
  BusinessSettings,
  ProjectOffer,
  SaveProjectOffer,
} from '@qitu/contracts';
import styles from './business.module.css';

export function BusinessSettingsForm({
  initial,
  busy,
  save,
}: {
  initial: BusinessSettings;
  busy: boolean;
  save: (settings: BusinessSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  function text(
    key:
      | 'operatorName'
      | 'supportEmail'
      | 'registrationInfo'
      | 'privacyText'
      | 'termsText'
      | 'refundText',
    label: string,
    multiline = false,
  ) {
    return (
      <label className={styles.field}>
        {label}
        {multiline ? (
          <textarea
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            rows={5}
            maxLength={key === 'refundText' ? 8000 : 16000}
          />
        ) : (
          <input
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            type={key === 'supportEmail' ? 'email' : 'text'}
            maxLength={key === 'registrationInfo' ? 500 : 150}
          />
        )}
      </label>
    );
  }
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2>经营资料与服务约定</h2>
          <p>家长下单时会保存当时的条款。请填写经过核对的正式内容。</p>
        </div>
        <span className={styles.tag}>修订 {initial.revision}</span>
      </div>
      <div className={styles.columns}>
        {text('operatorName', '经营主体名称')}
        {text('supportEmail', '客服邮箱')}
      </div>
      {text('registrationInfo', '备案、业务范围与联系方式说明')}
      <details>
        <summary>编辑隐私、服务与退款规则</summary>
        <div className={styles.stack}>
          {text('privacyText', '隐私与未成年人数据说明', true)}
          {text('termsText', '服务条款与交付边界', true)}
          {text('refundText', '退款规则', true)}
        </div>
      </details>
      <p className={styles.note}>
        资料完整仅表示已填写。经营资质、内容版权与适用备案仍需由经营者核实。
      </p>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={draft.salesEnabled}
          onChange={(e) => setDraft({ ...draft, salesEnabled: e.target.checked })}
        />
        开放项目包购买
      </label>
      <div className={styles.divider} />
      <h3>运营检查</h3>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={draft.automationEnabled}
          onChange={(e) => setDraft({ ...draft, automationEnabled: e.target.checked })}
        />
        每 5 分钟检查线索、退款和未开始的课程
      </label>
      <div className={styles.columns}>
        <label className={styles.field}>
          咨询跟进时限，小时
          <input
            type="number"
            min={1}
            max={168}
            value={draft.followupHours}
            onChange={(e) => setDraft({ ...draft, followupHours: Number(e.target.value) })}
          />
        </label>
        <label className={styles.field}>
          开通后尚未开始，天
          <input
            type="number"
            min={1}
            max={90}
            value={draft.inactivityDays}
            onChange={(e) => setDraft({ ...draft, inactivityDays: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className={styles.formFooter}>
        <p>通知显示在本工作区待办中。</p>
        <button disabled={busy} className={styles.primary} type="submit">
          {busy ? '正在保存…' : '保存经营配置'}
        </button>
      </div>
    </form>
  );
}

function emptyOffer(): SaveProjectOffer {
  return {
    id: '',
    revision: 0,
    templateVersionId: '',
    title: '',
    summary: '',
    audience: '',
    outcomes: [''],
    priceFen: 0,
    accessDays: 30,
    requiresPurchase: true,
    status: 'draft',
  };
}

export function OfferEditor({
  offer,
  templates,
  busy,
  save,
  close,
}: {
  offer: ProjectOffer | null;
  templates: BusinessDashboard['templates'];
  busy: boolean;
  save: (offer: SaveProjectOffer) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState<SaveProjectOffer>(offer ?? emptyOffer());
  const [price, setPrice] = useState(offer ? String(offer.priceFen / 100) : '');
  const [outcomes, setOutcomes] = useState(offer?.outcomes.join('\n') ?? '');
  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(price) * 100);
    void save({
      ...draft,
      priceFen: cents,
      outcomes: outcomes
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{offer ? '编辑项目包' : '创建项目包'}</h2>
          <p>向家长说明适合谁、交付什么，以及服务期限。</p>
        </div>
        <button type="button" className={styles.secondary} onClick={close}>
          收起
        </button>
      </div>
      <div className={styles.columns}>
        <label className={styles.field}>
          项目包名称
          <input
            required
            maxLength={80}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          适合人群与前置知识
          <input
            required
            maxLength={150}
            value={draft.audience}
            onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
          />
        </label>
      </div>
      <label className={styles.field}>
        课程版本
        <select
          required
          disabled={Boolean(offer?.publishedAt)}
          value={draft.templateVersionId}
          onChange={(e) => setDraft({ ...draft, templateVersionId: e.target.value })}
        >
          <option value="">选择已发布且安排有效的课程</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} · 版本 {t.version}
            </option>
          ))}
        </select>
      </label>
      {!templates.length && (
        <p className={styles.note}>暂无可售课程，请先到项目模板设置完成发布与教学安排。</p>
      )}
      <label className={styles.field}>
        项目介绍
        <textarea
          required
          maxLength={600}
          rows={3}
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        交付成果，每行一项
        <textarea
          required
          maxLength={1400}
          rows={3}
          value={outcomes}
          onChange={(e) => setOutcomes(e.target.value)}
          placeholder="例如：带观察证据的探究报告"
        />
      </label>
      <div className={styles.columns}>
        <label className={styles.field}>
          售价，元
          <input
            required
            type="number"
            min="0.01"
            max="100000"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          开通天数
          <input
            required
            type="number"
            min={1}
            max={730}
            value={draft.accessDays}
            onChange={(e) => setDraft({ ...draft, accessDays: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          disabled={Boolean(offer?.publishedAt)}
          checked={draft.requiresPurchase}
          onChange={(e) => setDraft({ ...draft, requiresPurchase: e.target.checked })}
        />
        此版本的新项目需要购买后确认
      </label>
      <p className={styles.note}>
        发布后课程版本与购买门槛冻结。已建立的学习记录继续由原教学流程管理。
      </p>
      <div className={styles.formFooter}>
        <label className={styles.field}>
          展示状态
          <select
            value={draft.status}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'draft' || v === 'published' || v === 'archived')
                setDraft({ ...draft, status: v });
            }}
          >
            <option value="draft">草稿</option>
            <option value="published">发布到官网</option>
            <option value="archived">下架</option>
          </select>
        </label>
        <button className={styles.primary} disabled={busy} type="submit">
          {busy ? '正在保存…' : '保存项目包'}
        </button>
      </div>
    </form>
  );
}
