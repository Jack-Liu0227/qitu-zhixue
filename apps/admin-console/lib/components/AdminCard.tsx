import type { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'default' | 'gradient' | 'interactive' | 'soft';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  variant = 'default',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return (
    <div className={cx('admin-card', `admin-card-${variant}`, className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('admin-card-header', className)} {...props}>{children}</div>;
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx('admin-card-title', className)} {...props}>{children}</h3>;
}

export function CardDescription({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('admin-card-description', className)} {...props}>{children}</p>;
}

export function CardContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('admin-card-content', className)} {...props}>{children}</div>;
}

export function CardFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('admin-card-footer', className)} {...props}>{children}</div>;
}

export type AdminCardChildren = ReactNode;
