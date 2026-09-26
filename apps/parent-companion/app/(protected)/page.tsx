import { ParentHomePage } from '../../features/portal';

/**
 * `/parent` — 孩子成长轨迹（家长投影）。
 *
 * 家长端与学生端读的是服务端同一份成长记录，只是投影字段不同；
 * 本页只展示 strength-based、过程性内容，不出现分数 / 排名 / 风险标签。
 */
export default function HomePage() {
  return <ParentHomePage />;
}
