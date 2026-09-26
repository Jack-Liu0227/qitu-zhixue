import type { AdminDataSource } from '@qitu/contracts';
import { Badge } from '@qitu/ui';

interface DataSourceBadgeProps {
  dataSource: AdminDataSource;
}

export function DataSourceBadge({ dataSource }: DataSourceBadgeProps) {
  if (dataSource === 'demo') {
    return (
      <Badge tone="attention" size="sm">
        演示数据
      </Badge>
    );
  }
  return null;
}
