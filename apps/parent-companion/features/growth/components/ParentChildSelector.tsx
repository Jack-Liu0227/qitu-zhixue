import { SegmentedControl } from '@qitu/ui';
import type { ChildRef } from '../types';

/**
 * 多孩子切换器。
 *
 * 只负责前端展示切换；真正的对象级权限仍由服务端逐次校验，
 * 前端隐藏 / 选择不能替代后端校验。
 */
export function ParentChildSelector({
  children,
  value,
  onChange,
}: {
  children: ChildRef[];
  value: string | null;
  onChange: (childId: string) => void;
}) {
  return (
    <div className="qitu-parent-child-selector">
      <SegmentedControl
        ariaLabel="选择要查看的孩子"
        items={children.map((child) => ({
          value: child.childId,
          label: `${child.displayName} · ${child.activeProjectCount} 个项目`,
        }))}
        value={value ?? children[0]!.childId}
        onChange={onChange}
      />
    </div>
  );
}
