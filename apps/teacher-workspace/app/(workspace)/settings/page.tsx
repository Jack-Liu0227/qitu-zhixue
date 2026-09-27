'use client';

import { useState, useEffect } from 'react';
import {
  ActivityIcon,
  CheckCircleIcon,
  PhoneIcon,
  SettingsIcon,
  SparklesIcon,
  TrendingUpIcon,
  AlertIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import {
  teacherApi,
  TeacherOfflineError,
  TeacherPermissionError,
  type TeacherSettingsPageData,
} from '../../../lib/teacherApi';

function ErrorState({ type }: { type: string }) {
  if (type === 'permission') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>权限不足</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>您没有访问系统设置的权限。</p>
        </div>
      </div>
    );
  }
  if (type === 'offline') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>网络连接失败</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>请检查网络连接后重试。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="qtx-page">
      <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>加载失败</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>数据加载时遇到问题，请稍后重试。</p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="qtx-page">
      <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <div
          style={{
            width: 48,
            height: 48,
            border: '4px solid #eef2f7',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'qitu-spin 1s linear infinite',
          }}
        />
        <p style={{ color: '#64748b', fontSize: 14 }}>加载中...</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<TeacherSettingsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<string>('');

  useEffect(() => {
    teacherApi
      .settings()
      .then((response) => {
        setData(response.data);
        if (response.data.sections.length > 0) {
          setSection(response.data.sections[0]!.id);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof TeacherPermissionError) setError('permission');
        else if (err instanceof TeacherOfflineError) setError('offline');
        else setError('generic');
        setLoading(false);
      });
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState type={error} />;
  if (!data) return <ErrorState type="generic" />;

  const currentSection = data.sections.find((s) => s.id === section);

  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <SettingsIcon size={28} />
              </div>
            </div>
            <div>
              <h2>系统设置</h2>
              <p>
                {data.teacherOverrideAllowed
                  ? '调整 AI 导师策略、协同干预与三端权限规则。'
                  : '查看 AI 导师策略、协同干预与三端权限规则（只读）。'}
              </p>
            </div>
          </div>
          <div className="qtx-banner-slogan">好的系统设置，是让老师少操心、多陪伴。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">
              {data.dataSource === 'demo' ? '🧪 演示数据' : '🤖 所有策略变更都会生成审计记录～'}
            </div>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#38bdf8,#6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
              }}
            >
              🤖
            </div>
          </div>
        </div>
      </section>

      {/* 监控卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard
          label="策略配置"
          value={data.teacherOverrideAllowed ? '可编辑' : '只读'}
          delta={null}
          icon={<ActivityIcon size={22} />}
          tone={data.teacherOverrideAllowed ? '#059669' : '#94a3b8'}
        />
        <MetricCard
          label="管理入口"
          value="管理后台"
          delta={null}
          icon={<TrendingUpIcon size={22} />}
          tone="#2563eb"
        />
        <MetricCard
          label="配置项数量"
          value={String(data.sections.length)}
          delta={null}
          icon={<SparklesIcon size={22} />}
          tone="#4f46e5"
        />
        <MetricCard
          label="激活项"
          value={String(data.sections.filter((s) => s.active).length)}
          delta={null}
          icon={<PhoneIcon size={22} />}
          tone="#0d9488"
        />
      </section>

      {/* 设置主体 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-4 qtx-card" style={{ padding: 8 }}>
          {data.sections.length === 0 ? (
            <div className="qtx-note" style={{ margin: 8 }}>
              当前暂无可见的策略配置项。
            </div>
          ) : (
            data.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: 0,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: section === s.id ? '#eff6ff' : 'transparent',
                  color: section === s.id ? '#1d4ed8' : '#475569',
                  fontWeight: section === s.id ? 700 : 500,
                  fontSize: 13,
                  transition: 'all .15s ease',
                }}
              >
                {s.label}
                {section === s.id ? <CheckCircleIcon size={16} /> : null}
              </button>
            ))
          )}
        </div>

        <div className="qtx-col-8 qtx-card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              padding: 18,
              background: '#f8fafc',
              borderBottom: '1px solid #eef2f7',
            }}
          >
            <strong style={{ fontSize: 15, color: '#1e293b' }}>
              {currentSection?.label ?? '—'}
            </strong>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              {data.teacherOverrideAllowed
                ? '保存后立即生效，并记录当前登录账号与时间戳。'
                : '此配置由管理后台统一管理，班主任端为只读视图。'}
            </div>
          </div>

          <div style={{ padding: 20, display: 'grid', gap: 14 }}>
            {currentSection ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 14,
                  borderRadius: 13,
                  border: '1px solid #eef2f7',
                  background: '#fff',
                }}
              >
                <div>
                  <strong style={{ fontSize: 13, color: '#1e293b' }}>
                    {currentSection.label}
                  </strong>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    {currentSection.description}
                  </div>
                </div>
                <span
                  className={`qtx-badge ${currentSection.active ? 'qtx-badge-emerald' : 'qtx-badge-slate'}`}
                >
                  {currentSection.active ? '已启用' : '未启用'}
                </span>
              </div>
            ) : null}

            {!data.teacherOverrideAllowed && (
              <div
                style={{
                  marginTop: 10,
                  padding: 14,
                  borderRadius: 12,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  fontSize: 13,
                  color: '#92400e',
                  lineHeight: 1.6,
                }}
              >
                <strong>管理说明</strong>：启发式策略、干预条件、权限规则与脱敏配置由管理后台统一管理（
                <code>{data.managedByRoute}</code>
                ）。班主任端仅可查看当前生效的配置，不支持直接修改，确保全平台策略一致性。
              </div>
            )}
          </div>

          {data.teacherOverrideAllowed && (
            /*
              契约里的设置是只读投影，没有写入接口；用非交互说明代替禁用按钮。
            */
            <div style={{ padding: '0 20px 20px' }}>
              <div className="qtx-note">
                设置写入接口暂未开放，当前仅支持查看；需要变更时请在管理后台完成。
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
