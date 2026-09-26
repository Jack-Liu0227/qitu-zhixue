import { EmptyState } from '@qitu/ui';
import Link from 'next/link';

export default function AdminHomePage() {
  return (
    <div className="admin-overview-page">
      <div className="admin-page-header">
        <h1>概览</h1>
        <p>平台管理后台的运行状态总览。目前只接入了「模型配置」这一个功能模块。</p>
      </div>

      <EmptyState
        title="暂无统计数据"
        description="平台管理后台还没有可用的数据源，因此概览页不展示任何虚构指标。请先前往「模型配置」完成首个可用功能。"
        action={
          <Link className="qitu-button qitu-button-primary" href="/models">
            前往模型配置
          </Link>
        }
      />
    </div>
  );
}
