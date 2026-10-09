import Link from 'next/link';

import { Icon, type IconName } from './icons';

export interface DemoModalProps {
  label: string;
  variant?: 'ghost' | 'outline' | 'primary';
  icon?: IconName;
  className?: string;
  destination?: string;
}

/**
 * 首页的体验入口直接进入真实工作空间登录流程。
 * 之前这里打开的是静态演示弹窗，用户点击后不会抵达可用地址，容易把示意内容误认为产品数据。
 */
export function DemoModal({
  label,
  variant = 'ghost',
  icon,
  className,
  destination = '/login',
}: DemoModalProps) {
  const triggerClass = ['home-btn', `home-btn--${variant}`, className]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');

  return (
    <Link className={triggerClass} href={destination}>
      {icon !== undefined ? <Icon name={icon} size={18} /> : null}
      <span>{label}</span>
    </Link>
  );
}
