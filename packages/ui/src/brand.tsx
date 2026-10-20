import { PRODUCT_NAME } from '@qitu/design-tokens';
import markLogo from '../assets/brand/qitu-sidebar-companion-v2.png';

/** 静态导入在 Next 中返回对象（含已补 basePath 的 src），兼容直接返回字符串的打包器。 */
function srcOf(image: { src: string } | string): string {
  return typeof image === 'string' ? image : image.src;
}

const MARK_RATIO = 1;

/**
 * 启途智学图形标志（透明底，无文字），用于侧边栏等小尺寸位置。
 * 旁边已有品牌名文字时传 `decorative`，避免读屏重复朗读。
 */
export function BrandMark({
  size = 40,
  decorative = false,
  className,
}: {
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <img
      className={className ? `qitu-brand-mark ${className}` : 'qitu-brand-mark'}
      src={srcOf(markLogo)}
      width={size}
      height={Math.round(size * MARK_RATIO)}
      alt={decorative ? '' : PRODUCT_NAME}
      aria-hidden={decorative ? true : undefined}
      draggable={false}
    />
  );
}

/** 完整品牌 logo（图形 + “启途智学 / QITU ZHIXUE”），用于登录页等展示位置。 */
export function BrandLogo({ width = 200, className }: { width?: number; className?: string }) {
  return (
    <span
      className={className ? `qitu-brand-logo ${className}` : 'qitu-brand-logo'}
      style={{ width, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
    ><BrandMark size={Math.round(width * 0.28)} decorative /><strong style={{ fontSize: Math.round(width * 0.14), color: 'var(--qitu-text, #102a5c)', whiteSpace: 'nowrap', letterSpacing: '-0.04em' }}>{PRODUCT_NAME}</strong></span>
  );
}
