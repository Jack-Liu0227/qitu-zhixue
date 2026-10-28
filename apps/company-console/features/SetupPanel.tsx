import Link from 'next/link';
import type { CompanyOverview } from '@qitu/contracts';

export function SetupPanel({ data }: { data: CompanyOverview }) {
  const enabled = data.teams.filter((team) => team.enabled && team.assistantId).length;
  const completed = data.work.some((work) => work.status === 'succeeded');
  const published = data.catalog.products.filter(
    (product) => product.status === 'published',
  ).length;
  return (
    <section className="panel setup-panel" aria-labelledby="company-setup-title">
      <div className="panel-title">
        <div>
          <span className="eyebrow">开始使用</span>
          <h2 id="company-setup-title">初始化与可用状态</h2>
        </div>
        <span className="tag succeeded">基础工作区已连接</span>
      </div>
      <p className="muted">知识管理和内部工作可独立使用。收款与飞书按需要另行配置。</p>
      <ol className="setup-list">
        <li>
          <strong>1. 基础经营</strong>
          <p>
            当前权限：{data.role === 'owner' ? '公司所有者' : data.role}
            。可按角色查看数据、维护公司知识和登记真实经营资料。
          </p>
          <Link href="/knowledge">维护公司知识 →</Link>
        </li>
        <li>
          <strong>
            2. 公司助手 · {enabled} / {data.teams.length} 个部门已启用
          </strong>
          <p>先在 Admin 配置模型和专用助手，再绑定部门。绑定完成后还需执行一项工作确认模型可用。</p>
          <a href="/admin/settings/assistants">配置助手 ↗</a>
          {' · '}
          <Link href="/teams">绑定部门 →</Link>
        </li>
        <li>
          <strong>3. 执行验证 · {completed ? '已有成功成果' : '等待首项工作完成'}</strong>
          <p>
            {enabled
              ? '选择已启用部门，填写目标后委派工作；失败原因和真实成果会保留。'
              : '先启用至少一个部门助手，再委派工作。'}
          </p>
          <Link href="/work">查看工作与成果 →</Link>
        </li>
        <li>
          <strong>
            4. 订阅售卖 · {data.catalog.purchasing.available ? '购买通道已开放' : '尚未开放'}
          </strong>
          <p>
            {published} 个产品已发布。{data.catalog.purchasing.reason}
            ；售卖还需有效课程绑定、经营条款及微信商户配置。
          </p>
          <Link href="/products">配置产品 →</Link>
          {' · '}
          <a href="/admin/settings/ops">经营与支付设置 ↗</a>
        </li>
        <li>
          <strong>5. 飞书集成 · 可选</strong>
          <p>需要群内委派时，再绑定机器人、群和发送人；内部工作不依赖飞书。</p>
          <Link href="/integrations">检查集成状态 →</Link>
        </li>
      </ol>
    </section>
  );
}
