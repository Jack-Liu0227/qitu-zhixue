'use client';
import { useState } from 'react';
import Link from 'next/link';
import { COMPANY_DEPARTMENTS, type CompanyTeam, type CompanyWork } from '@qitu/contracts';
import type { PanelProps } from './CompanyWorkspace';
import { date, money } from './api';
const state: Record<CompanyWork['status'], string> = {
  queued: '等待执行',
  running: '正在执行',
  succeeded: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
};
export function OverviewPanel({ data }: PanelProps) {
  const m = data.metrics,
    enabled = data.teams.filter((t) => t.enabled).length;
  const maximum = Math.max(1, ...data.daily.map((d) => d.revenueFen));
  const recent = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() + 8 * 3600000 - (29 - i) * 86400000).toISOString().slice(0, 10);
    return data.daily.find((row) => row.day === d) ?? { day: d, revenueFen: 0, orders: 0 };
  });
  return (
    <>
      <div className="metrics-strip">
        {[
          ['累计实收', money(m.revenueFen), '已验证支付回执'],
          ['有效会员', String(m.activeMembers), '去重学生 · 当前有效'],
          ['学习项目', String(m.projects), `${m.completedProjects} 个已完成`],
          ['待执行工作', String(m.pendingWork), `${enabled} / 12 个部门已启用`],
        ].map(([title, value, note]) => (
          <article key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel revenue-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">BUSINESS PULSE</span>
              <h2>经营脉搏</h2>
            </div>
            <span className="tag">最近 30 天</span>
          </div>
          <div className="chart-total">
            {money(recent.reduce((sum, d) => sum + d.revenueFen, 0))}
            <small>已支付订单金额 · 未扣退款</small>
          </div>
          <div className="bar-chart" role="img" aria-label="最近 30 天每日收款趋势">
            {recent.map((d) => (
              <div key={d.day} title={`${d.day} · ${money(d.revenueFen)}`}>
                <span
                  style={{
                    height: `${Math.max(d.revenueFen ? 4 : 1, (d.revenueFen / maximum) * 100)}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="chart-axis">
            <span>{recent[0]?.day}</span>
            <span>{recent.at(-1)?.day}</span>
          </div>
          {!data.daily.length && (
            <p className="muted">尚无已验证的收款。第一笔支付成功后会出现在这里。</p>
          )}
        </section>
        <section className="panel focus-panel">
          <span className="eyebrow">TODAY'S FOCUS</span>
          <h2>让下一步更明确</h2>
          <div className="focus-item">
            <b>01</b>
            <div>
              <strong>
                {data.catalog.purchasing.available ? '购买通道已开放' : '完成售卖准备'}
              </strong>
              <p>{data.catalog.purchasing.reason}</p>
              <Link href="/products">查看产品与目录 →</Link>
            </div>
          </div>
          <div className="focus-item">
            <b>02</b>
            <div>
              <strong>{enabled ? `${enabled} 个部门准备就绪` : '组建你的 Agent 团队'}</strong>
              <p>绑定平台已配置的助手，明确每个部门的职责。</p>
              <Link href="/teams">管理团队 →</Link>
            </div>
          </div>
          <div className="focus-item">
            <b>03</b>
            <div>
              <strong>用一项工作检验交付</strong>
              <p>委派经营分析、产品梳理或客户服务任务，查看实际成果。</p>
              <Link href="/work">进入工作台 →</Link>
            </div>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>最近的团队工作</h2>
          <Link href="/work">查看全部 →</Link>
        </div>
        <WorkTable work={data.work.slice(0, 5)} />
      </section>
    </>
  );
}
function WorkTable({ work }: { work: CompanyWork[] }) {
  return work.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>任务</th>
            <th>部门</th>
            <th>状态</th>
            <th>更新</th>
          </tr>
        </thead>
        <tbody>
          {work.map((w) => (
            <tr key={w.id}>
              <td>{w.title}</td>
              <td>{COMPANY_DEPARTMENTS.find((d) => d.id === w.department)?.name}</td>
              <td>
                <span className={`tag ${w.status}`}>{state[w.status]}</span>
              </td>
              <td>{date(w.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty">还没有委派工作。先配置一个部门助手，再创建第一个任务。</div>
  );
}
export function WorkPanel({ data, act, busy }: PanelProps) {
  const [department, setDepartment] = useState('management'),
    [title, setTitle] = useState(''),
    [brief, setBrief] = useState('');
  const canOperate = ['owner', 'operator'].includes(data.role);
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>委派一项工作</h2>
          <span className="tag">单次有界执行 · 可审阅成果</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act('company/work', { department, title, brief });
          }}
          className="work-form"
        >
          <label>
            责任部门
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              {COMPANY_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {data.teams.find((t) => t.department === d.id)?.enabled ? '' : ' · 待配置'}
                </option>
              ))}
            </select>
          </label>
          <label>
            任务标题
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：分析本周会员转化与交付缺口"
            />
          </label>
          <label className="wide">
            期望成果
            <textarea
              required
              maxLength={4000}
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="说明目标、需要回答的问题，以及成果的验收标准。请勿填写学生原始对话或密钥。"
            />
          </label>
          <div className="form-footer wide">
            <small>
              每 24 小时最多 50 个任务，每项最多 3 次执行。对外发布和资金操作仍由你处理。
            </small>
            <button disabled={busy || !canOperate}>委派工作 ↗</button>
          </div>
        </form>
      </section>
      <section className="work-list">
        {!data.work.length && <div className="panel empty">暂无工作记录。</div>}
        {data.work.map((w) => (
          <article className="panel" key={w.id}>
            <div className="panel-title">
              <div>
                <span className="eyebrow">
                  {COMPANY_DEPARTMENTS.find((d) => d.id === w.department)?.name} · 第 {w.attempts}{' '}
                  次执行
                </span>
                <h2>{w.title}</h2>
              </div>
              <span className={`tag ${w.status}`}>{state[w.status]}</span>
            </div>
            <p className="muted">{w.brief}</p>
            {w.result && (
              <details open>
                <summary>查看工作成果</summary>
                <pre className="result">{w.result}</pre>
              </details>
            )}
            {w.error && <p className="alert">{w.error}</p>}
            <div className="form-footer">
              <small>{date(w.updatedAt)}</small>
              <div>
                {w.status === 'failed' && w.attempts < 3 && (
                  <button
                    className="secondary"
                    disabled={busy || !canOperate}
                    onClick={() => void act(`company/work/${w.id}`, { action: 'retry' }, 'PATCH')}
                  >
                    重试
                  </button>
                )}
                {['queued', 'running'].includes(w.status) && (
                  <button
                    className="secondary"
                    disabled={busy || !canOperate}
                    onClick={() => void act(`company/work/${w.id}`, { action: 'cancel' }, 'PATCH')}
                  >
                    取消任务
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
export function TeamsPanel(props: PanelProps) {
  return (
    <>
      <div className="callout">
        <strong>12 个职能，共用一套受治理的助手配置。</strong>
        <p>
          在 Admin 创建和配置助手，再将它绑定到公司部门。公司任务使用经营汇总数据，生成可审阅成果。
        </p>
        <a href="/admin">配置平台助手 ↗</a>
      </div>
      <div className="department-grid">
        {COMPANY_DEPARTMENTS.map((d, i) => (
          <TeamCard
            key={d.id}
            {...props}
            team={props.data.teams.find((t) => t.department === d.id)!}
            index={i}
          />
        ))}
      </div>
    </>
  );
}
function TeamCard({
  team,
  data,
  busy,
  act,
  index,
}: PanelProps & { team: CompanyTeam; index: number }) {
  const [assistant, setAssistant] = useState(team.assistantId ?? '');
  const d = COMPANY_DEPARTMENTS.find((d) => d.id === team.department)!;
  return (
    <article className="panel department">
      <div className="panel-title">
        <span className="department-number">{String(index + 1).padStart(2, '0')}</span>
        <span className={`tag ${team.enabled ? 'succeeded' : ''}`}>
          {team.enabled ? '已启用' : '待配置'}
        </span>
      </div>
      <h2>{d.name}</h2>
      <p>{d.mission}</p>
      {data.role === 'owner' ? (
        <>
          <label>
            执行助手
            <select value={assistant} onChange={(e) => setAssistant(e.target.value)}>
              <option value="">选择 Admin 中的助手</option>
              {data.assistants.map((a) => (
                <option value={a.id} key={a.id} disabled={!a.enabled}>
                  {a.name}
                  {a.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </select>
          </label>
          <div className="form-footer">
            <small>版本 {team.revision}</small>
            <button
              className="secondary"
              disabled={busy || (!assistant && !team.enabled)}
              onClick={() =>
                void act(
                  'company/teams',
                  {
                    department: team.department,
                    revision: team.revision,
                    assistantId: assistant || null,
                    enabled: !team.enabled,
                  },
                  'PATCH',
                )
              }
            >
              {team.enabled ? '停用' : '绑定并启用'}
            </button>
          </div>
        </>
      ) : (
        <small>{team.assistantId ? '已绑定平台助手' : '等待所有者配置'}</small>
      )}
    </article>
  );
}
export function DataPanel({ data }: PanelProps) {
  const rows = [
    ['有效学生', data.metrics.students, 'users', '未停用的学生账号'],
    ['家长账号', data.metrics.parents, 'users', '未停用家长，不单独收会员费'],
    ['教师账号', data.metrics.teachers, 'users', '只读观察学习'],
    ['学习项目', data.metrics.projects, 'projects', '已创建正式项目'],
    ['完成项目', data.metrics.completedProjects, 'projects', '学习服务确认 completed'],
    ['订单数', data.metrics.orders, 'business_orders', '包含待支付、关闭、退款'],
    ['已支付订单', data.metrics.paidOrders, 'business_orders', '支付验签成功，包含后续退款'],
    ['累计实收（分）', data.metrics.revenueFen, 'business_orders', '按支付回执累计，未扣退款'],
    ['已退款（分）', data.metrics.refundedFen, 'business_orders', '退款成功回执金额'],
    [
      '已记录成本（分）',
      data.metrics.expenseFen,
      'business_expenses',
      '仅已录入项目，不代表完整成本',
    ],
    ['模型调用', data.metrics.aiCalls, 'business_model_usage', '底层调用次数，与学生交互额度不同'],
    [
      '用量未知调用',
      data.metrics.unknownUsage,
      'business_model_usage',
      'Token 信息缺失，不能按零成本处理',
    ],
    ['有效会员', data.metrics.activeMembers, 'commerce_grants', '当前生效个人会员，按学生去重'],
    ['机构', data.metrics.organizations, 'commerce_organizations', '已登记机构数量'],
  ];
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>全域经营数据字典</h2>
        <span className="tag">累计数据 · 当前有效指标另行标注</span>
      </div>
      <p className="muted">
        数据范围覆盖账号、学习交付、交易、会员、机构和模型用量。原始学生对话和密钥不进入经营视图。
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>指标</th>
              <th>值</th>
              <th>来源</th>
              <th>统计口径</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value, source, note]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="numeric">{value}</td>
                <td>
                  <code>{source}</code>
                </td>
                <td>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
