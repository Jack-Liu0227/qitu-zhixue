import { cloneElement, isValidElement, useId } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, ReactElement, ReactNode } from 'react';
import { colors } from '@qitu/design-tokens';

/** 拼接 className，过滤空值，供本文件内的基础组件复用。 */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function SectionCard({
  title,
  action,
  children,
  padded = true,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={padded ? 'qitu-section-card is-padded' : 'qitu-section-card'}>
      {title || action ? (
        <header className="qitu-section-card-header">
          {title ? <h2 className="qitu-section-card-title">{title}</h2> : null}
          {action ? <div className="qitu-section-card-action">{action}</div> : null}
        </header>
      ) : null}
      <div className="qitu-section-card-body">{children}</div>
    </section>
  );
}

export function TagChips({
  tags,
  tone = 'neutral',
}: {
  tags: string[];
  tone?: 'neutral' | 'primary' | 'completed' | 'attention';
}) {
  return (
    <div className={`qitu-tag-chips qitu-tag-${tone}`}>
      {tags.map((tag, index) => (
        <span key={`${tag}-${index}`} className="qitu-tag-chip">
          {tag}
        </span>
      ))}
    </div>
  );
}

export function StatTriple({
  items,
}: {
  items: { label: string; value: string; tone?: 'default' | 'completed' | 'attention' }[];
}) {
  return (
    <div className="qitu-stat-triple">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className={`qitu-stat-triple-item qitu-stat-triple-${item.tone ?? 'default'}`}
        >
          <span className="qitu-stat-triple-label">{item.label}</span>
          <strong className="qitu-stat-triple-value">{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * 学习进度条。
 *
 * `percent` 仅用于展示：进度由后端/学习引擎计算并下发，
 * 客户端不得直接写入进度值。
 */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="qitu-progress">
      {label ? <span className="qitu-progress-label">{label}</span> : null}
      <div
        className="qitu-progress-track"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="qitu-progress-fill"
          style={{ width: `${clamped}%`, backgroundColor: colors.primary } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function StageBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'locked' | 'current' | 'done' | 'attention';
}) {
  return <span className={`qitu-stage-badge qitu-stage-${tone}`}>{label}</span>;
}

export function InfoRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={muted ? 'qitu-info-row is-muted' : 'qitu-info-row'}>
      <span className="qitu-info-label">{label}</span>
      <span className="qitu-info-value">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 基础组件层：纯展示、无副作用，仅依赖 `react` 与 `@qitu/design-tokens`。
 * 全部为新增导出，不改变既有组件的名字与 props 签名。
 * ------------------------------------------------------------------ */

/**
 * 加载指示器。默认对屏幕阅读器可见（`role="status"`）；
 * 若被按钮等已经播报状态的容器包裹，可传 `label` 自定义文案。
 */
export function Spinner({
  size = 'md',
  label = '加载中',
}: {
  size?: 'sm' | 'md' | 'lg' | number;
  label?: string;
}) {
  const dimension = typeof size === 'number' ? size : size === 'sm' ? 14 : size === 'lg' ? 28 : 18;
  return (
    <span
      className={cx('qitu-spinner', `qitu-spinner-${typeof size === 'number' ? 'custom' : size}`)}
      role="status"
      aria-label={label}
      style={{ width: dimension, height: dimension }}
    >
      <span className="qitu-spinner-circle" aria-hidden="true" />
    </span>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leading,
  trailing,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('qitu-button', `qitu-button-${variant}`, `qitu-button-${size}`, loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
    >
      {loading ? (
        <Spinner size="sm" label="处理中" />
      ) : leading ? (
        <span className="qitu-button-leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="qitu-button-label">{children}</span>
      {trailing ? (
        <span className="qitu-button-trailing" aria-hidden="true">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/** 通用卡片：可选标题/描述/操作区与页脚。 */
export function Card({
  title,
  description,
  action,
  footer,
  padded = true,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title || description || action);
  return (
    <section className={cx('qitu-card', padded && 'is-padded', className)}>
      {hasHeader ? (
        <header className="qitu-card-header">
          <div className="qitu-card-heading">
            {title ? <h2 className="qitu-card-title">{title}</h2> : null}
            {description ? <p className="qitu-card-description">{description}</p> : null}
          </div>
          {action ? <div className="qitu-card-action">{action}</div> : null}
        </header>
      ) : null}
      <div className="qitu-card-body">{children}</div>
      {footer ? <footer className="qitu-card-footer">{footer}</footer> : null}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  size = 'md',
  className,
  children,
}: {
  tone?: 'neutral' | 'primary' | 'completed' | 'attention' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx('qitu-badge', `qitu-badge-${tone}`, `qitu-badge-${size}`, className)}>{children}</span>;
}

export function SegmentedControl<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  disabled = false,
  className,
}: {
  items: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx('qitu-segmented', `qitu-segmented-${size}`, className)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || item.disabled}
            className={cx('qitu-segment', active && 'is-active')}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Avatar({
  name,
  src,
  alt,
  size = 'md',
}: {
  name?: string;
  src?: string;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initial = name ? (Array.from(name.trim())[0] ?? '') : '';
  if (src) {
    return (
      <span className={cx('qitu-avatar', `qitu-avatar-${size}`)}>
        <img className="qitu-avatar-img" src={src} alt={alt ?? name ?? ''} />
      </span>
    );
  }
  return (
    <span
      className={cx('qitu-avatar', `qitu-avatar-${size}`, 'is-initials')}
      role="img"
      aria-label={name ?? '用户头像'}
      title={name}
    >
      {initial}
    </span>
  );
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: 'ghost' | 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx('qitu-icon-button', `qitu-icon-button-${variant}`, `qitu-icon-button-${size}`, className)}
    >
      {children}
    </button>
  );
}

export function Divider({
  orientation = 'horizontal',
  label,
}: {
  orientation?: 'horizontal' | 'vertical';
  label?: ReactNode;
}) {
  if (orientation === 'vertical') {
    return <span className="qitu-divider qitu-divider-vertical" role="separator" aria-orientation="vertical" />;
  }
  return (
    <div className="qitu-divider qitu-divider-horizontal" role="separator" aria-orientation="horizontal">
      {label ? <span className="qitu-divider-label">{label}</span> : null}
    </div>
  );
}

export function Toolbar({
  align = 'between',
  wrap = false,
  className,
  children,
}: {
  align?: 'start' | 'center' | 'between' | 'end';
  wrap?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('qitu-toolbar', `qitu-toolbar-${align}`, wrap && 'is-wrap', className)}>{children}</div>
  );
}

/**
 * 表单字段包装：负责 label、hint、error 的排版与可访问性关联。
 * 会给单个表单控件子元素注入 `id`、`aria-invalid`、`aria-describedby`、`aria-required`。
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? htmlFor ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })
    : children;

  return (
    <div className={cx('qitu-field', error ? 'has-error' : false, className)}>
      <label className="qitu-field-label" htmlFor={controlId}>
        <span>{label}</span>
        {required ? (
          <span className="qitu-field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="qitu-field-control">{control}</div>
      {hint ? (
        <p className="qitu-field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="qitu-field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
