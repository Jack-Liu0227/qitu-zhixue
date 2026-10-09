import Link from 'next/link';

import type { PublicHomeStats, PublicHomeTemplate, PublicHomeView } from '@qitu/contracts';

import { ConsultationForm } from './home/consult-form';
import { DemoModal } from './home/demo-modal';
import { countLabel } from './home/format';
import { HeroTutorDemo } from './home/hero-demo';
import { Icon, type IconName } from './home/icons';
import { TemplateShowcase } from './home/showcase';
import { SiteNav } from './home/site-nav';

/**
 * 营销首页（服务端渲染）。
 *
 * 数据来源：`GET /api/v1/public/home`（公开只读，只回聚合计数与平台共享模板）。
 * 后端不可用时**不伪造数字**：统计位显示 `—` 并给出降级提示，展厅回到空状态。
 */
export const revalidate = 60;

const API_ORIGIN = process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100';
const HOME_FETCH_TIMEOUT_MS = 3_000;

interface PblStep {
  index: string;
  icon: IconName;
  title: string;
  detail: string;
  outcome: string;
}

interface Competency {
  icon: IconName;
  name: string;
  en: string;
  detail: string;
  metrics: string;
}

const PBL_STEPS: readonly PblStep[] = [
  {
    index: '01',
    icon: 'search',
    title: '真实问题精准定义',
    detail:
      '从碳足迹量化、城市潮汐车道优化到历史档案重构。学生在多元社会图景中捕捉痛点，明确核心研究议题。',
    outcome: '立项意向与研究假设书',
  },
  {
    index: '02',
    icon: 'brain',
    title: 'AI 协同探究与验证',
    detail:
      '对话定制化领域智能体。借助多维文献检索、数据仿真与逆向推演，快速验证初步假设的严密性与可行性。',
    outcome: '多变量数据仿真图谱',
  },
  {
    index: '03',
    icon: 'wrench',
    title: '原型作品构建与迭代',
    detail:
      '告别纸上谈兵。结合低代码开发、3D 建模、硬件原型或交互式大模型问答引擎，将理论转化为可交互工程实体。',
    outcome: '高保真原型系统与代码库',
  },
  {
    index: '04',
    icon: 'award',
    title: '多元复盘与能力认证',
    detail:
      '组织同行评审答辩，AI 全流程评估推演日志，自动沉淀形成可追溯的个人成长能力档案与数字学术徽章。',
    outcome: '可追溯的能力认证记录',
  },
];

const COMPETENCIES: readonly Competency[] = [
  {
    icon: 'brain',
    name: '批判性思维与深度问辨',
    en: 'Critical Thinking & Prompt Inquiry',
    detail:
      '拒绝轻信标准答案，掌握向生成式大模型提出高质量反思性 Prompt 的技能。学会识别逻辑漏洞、因果颠倒及认知偏见。',
    metrics: '逻辑链深度 / 逆向追问频次',
  },
  {
    icon: 'terminal',
    name: '计算思维与跨学科建模',
    en: 'Computational & Algorithmic Mindset',
    detail:
      '将混沌复杂的大千世界拆解为可计算的数据结构与算法流程。融汇物理原理、社会学规律与统计学模型解决现实挑战。',
    metrics: '抽象建模能力 / 参数鲁棒性',
  },
  {
    icon: 'wrench',
    name: '复杂问题解决与工程创造',
    en: 'Complex Problem Solving',
    detail:
      '具备强韧的「动手做」精神，完成智能物联网硬件打样、定制软件开发或实地调研论文，从 0 到 1 产出具有实用价值的物化作品。',
    metrics: '工程实操完整度 / 迭代抗挫力',
  },
  {
    icon: 'refresh',
    name: '自主元认知与终身学习力',
    en: 'Metacognition & Adaptive Learning',
    detail:
      '清晰洞察「我知道什么」与「我不知道什么」。借助平台即时认知回溯树，实时审视思维盲区，自发制定学习补强计划。',
    metrics: '自我反思深度 / 策略敏捷调整率',
  },
  {
    icon: 'hub',
    name: '人机协作与数字共创素养',
    en: 'AI Synergy & Future Literacy',
    detail:
      '不再将 AI 视作替身，而是将之作为第二大脑与智囊团。熟练运用协同编码、生成式图像推演与文献聚类加速研究进程。',
    metrics: '人机工作流效率 / AI 伦理合规',
  },
  {
    icon: 'forum',
    name: '同理心沟通与共情领导力',
    en: 'Empathic Leadership & Storytelling',
    detail:
      '在团队协作中换位思考、倾听异见，将晦涩的科技方案转译为打动人心的叙事。在公开答辩与路演中展现自信与领导力。',
    metrics: '团队同行评价 / 演讲说服力指数',
  },
];

const TESTIMONIALS = [
  {
    initial: '陈',
    name: '陈思齐（高二年级）',
    note: '完成 3 项 PBL 课题 · 获 ISEF 省级选拔推荐',
    quote:
      '以前做题总是只看考卷给的标准答案，在启途做完《微塑料降解菌种环境模拟》项目后，我发现真实世界的科学没有唯一解。AI 导师从不直接告诉我答案，而是一步步追问，逼我自己理顺实验因果逻辑。',
  },
  {
    initial: '张',
    name: '张工（资深算法架构师 / 初中生家长）',
    note: '持续伴学 180 天',
    quote:
      '作为计算机系家长，我最抗拒把 AI 当作「偷懒作弊工具」。启途智学的引导机制太妙了，它把孩子培养成驾驭 AI 的领航员，教孩子自己提问、自查逻辑，这种自主元认知是课本里学不到的无价之宝。',
  },
  {
    initial: '李',
    name: '李建荣 特级教师',
    note: '重点示范高中科创教研组长',
    quote:
      '我们学校引入启途的项目工作坊后，孩子们的课堂参与度有了飞跃。特别是「能力罗盘报告」，每学期生成的多维雷达评估能清晰展示出学生的跨学科整合力，是面向新高考与综合素质评价的重器。',
  },
] as const;

const CONTACT_ROWS: ReadonlyArray<{ icon: IconName; label: string; value: string; hint?: string }> = [
  {
    icon: 'location',
    label: '总部研发中心',
    value: '北京市海淀区中关村前沿科技创新中心 A 座 12 层',
  },
  {
    icon: 'mail',
    label: '商务与生态合作邮箱',
    value: 'partner@qituzhixue.com',
  },
  {
    icon: 'phone',
    label: '全国课程与研学热线',
    value: '400-820-9188',
    hint: '周一至周日 09:00 - 21:00',
  },
  {
    icon: 'qr',
    label: '微信公众号',
    value: '启途智学科创智库',
    hint: '关注后回复「样章」获取课程样章',
  },
];

const FOOTER_COLUMNS = [
  {
    title: '创新产品',
    links: [
      { label: 'AI 驱动 PBL 项目工坊', href: '/login' },
      { label: '21 世纪核心能力罗盘', href: '/login' },
      { label: '苏格拉底式导师引擎', href: '/login' },
      { label: '高校与实验室互联链', href: '/login' },
    ],
  },
  {
    title: '关于生态',
    links: [
      { label: '关于启途智学', href: '#about' },
      { label: '品牌与教育理念', href: '/about' },
      { label: '研学基地合作', href: '#contact' },
      { label: '学术导师智库', href: '#contact' },
      { label: '教育公平公益计划', href: '#contact' },
      { label: '热门项目展厅', href: '#showcase' },
    ],
  },
] as const;

const FALLBACK_STATS: PublicHomeStats = {
  learners: 0,
  schools: 0,
  publishedTemplates: 0,
  publishedWorks: 0,
};

async function loadHomeView(): Promise<{ view: PublicHomeView | null; degraded: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOME_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/public/home`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 60 },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { view: null, degraded: true };
    }
    const payload = (await response.json()) as { data?: PublicHomeView };
    if (payload.data === undefined) {
      return { view: null, degraded: true };
    }
    return { view: payload.data, degraded: false };
  } catch {
    // 后端未就绪 / 超时：降级渲染，不阻塞首屏。
    return { view: null, degraded: true };
  } finally {
    clearTimeout(timer);
  }
}

export default async function HomePage() {
  const { view, degraded } = await loadHomeView();
  const stats = view?.stats ?? FALLBACK_STATS;
  const templates: PublicHomeTemplate[] = view?.templates ?? [];

  const heroStats = [
    {
      icon: 'group' as IconName,
      value: countLabel(stats.learners),
      label: '名在册学习者',
      hint: '平台在册学生账号，实时统计',
    },
    {
      icon: 'school' as IconName,
      value: countLabel(stats.schools),
      label: '所已接入学校',
      hint: '已完成接入并处于启用状态',
    },
    {
      icon: 'layers' as IconName,
      value: countLabel(stats.publishedTemplates),
      label: '个公开项目模板',
      hint: '平台共享且已发布的模板',
    },
  ];

  const aboutStats = [
    {
      icon: 'group' as IconName,
      value: countLabel(stats.learners),
      label: '在册学习者',
      hint: '正在平台上开展项目的学生账号',
    },
    {
      icon: 'school' as IconName,
      value: countLabel(stats.schools),
      label: '已接入学校',
      hint: '与平台完成接入并处于启用状态',
    },
    {
      icon: 'layers' as IconName,
      value: countLabel(stats.publishedTemplates),
      label: '公开项目模板',
      hint: '平台共享、可直接发起项目的模板',
    },
    {
      icon: 'rocket' as IconName,
      value: countLabel(stats.publishedWorks),
      label: '公开作品',
      hint: '学生作品中选择公开分享的数量',
    },
  ];

  return (
    <div className="home-page">
      <div className="home-orbs" aria-hidden="true">
        <span className="home-orb home-orb--primary" />
        <span className="home-orb home-orb--mint" />
        <span className="home-orb home-orb--violet" />
      </div>

      <SiteNav />

      <main className="home-main">
        <section className="home-hero" id="top">
          <div className="home-shell home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-badge">
                <span className="home-badge-pill">NEW</span>
                全新发布 · AI 驱动的沉浸式个性化项目学习平台 3.0
              </p>
              <h1 className="home-hero-title">
                让每一次学习
                <span className="home-hero-title-accent">都有明确方向</span>
              </h1>
              <p className="home-hero-sub">与 AI 共成长，启发真实世界新思维</p>
              <p className="home-hero-lead">
                在苏格拉底式启发对话中与 AI 导师一同探究真实挑战，在动手实践中让灵感成形。
                启途智学为你生成动态成长路径，并沉淀 6 维核心能力图谱。
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary home-btn--lg" href="/login">
                  立即开启 AI 探索之旅
                  <Icon name="arrowRight" size={18} />
                </Link>
                <DemoModal
                  label="观看 PBL 项目演示"
                  variant="outline"
                  icon="play"
                  className="home-btn--lg"
                />
              </div>
              <p className="home-trust">
                <span>
                  <Icon name="school" size={16} /> 校本课程与校本模板
                </span>
                <span>
                  <Icon name="brain" size={16} /> 苏格拉底式启发提问
                </span>
                <span>
                  <Icon name="bolt" size={16} /> 理论达标才解锁实践
                </span>
              </p>

              {degraded ? (
                <p className="home-data-note" role="status">
                  <Icon name="sensors" size={18} />
                  平台实时数据暂时无法获取，下方统计显示为「—」。稍后刷新页面即可重新获取，
                  你也可以直接登录查看自己的项目数据。
                </p>
              ) : null}

              <dl className="home-hero-stats">
                {heroStats.map((item) => (
                  <div className="home-stat" key={item.label}>
                    <dt>
                      <Icon name={item.icon} size={16} /> {item.label}
                    </dt>
                    <dd>
                      <strong>{degraded ? '—' : item.value}</strong>
                      <span>{item.hint}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <HeroTutorDemo />
          </div>
        </section>

        <section className="home-section" id="pbl">
          <div className="home-shell">
            <div className="home-section-head">
              <p className="home-eyebrow">
                <Icon name="layers" size={16} /> PBL 教学范式革新
              </p>
              <h2 className="home-section-title">打破被动死记硬背，以真实项目激活内驱力</h2>
              <p className="home-section-lead">
                真实挑战不会附带现成标准答案。启途智学将前沿 AI 工具与建构主义学习法深度融合，
                带领学生经历完整的「研究 — 假设 — 验证 — 落地」闭环。
              </p>
            </div>

            <ol className="home-step-grid">
              {PBL_STEPS.map((step) => (
                <li className="home-step-card" key={step.index}>
                  <span className="home-step-index">{step.index}</span>
                  <span className="home-step-icon" aria-hidden="true">
                    <Icon name={step.icon} size={22} />
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                  <p className="home-deliverable">
                    <Icon name="verified" size={16} />
                    交付物：{step.outcome}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="home-section home-section--tinted" id="competency">
          <div className="home-shell">
            <div className="home-section-head">
              <p className="home-eyebrow home-eyebrow--mint">
                <Icon name="target" size={16} /> 21 世纪素养罗盘
              </p>
              <h2 className="home-section-title">学生高阶核心能力拓展矩阵</h2>
              <p className="home-section-lead">
                超越单一分数考评，启途智学通过细分项目场景持续哺育并动态量化 6 大不可被 AI 替代的元能力。
              </p>
              <p className="home-metric-strip">
                <Icon name="chart" size={18} />
                能力雷达与掌握度由平台按学习行为记录计算，全过程留痕、可回溯。
              </p>
            </div>

            <div className="home-quad-grid">
              {COMPETENCIES.map((item) => (
                <article className="home-quad-card" key={item.name}>
                  <span className="home-quad-icon" aria-hidden="true">
                    <Icon name={item.icon} size={22} />
                  </span>
                  <h3 className="home-quad-name">{item.name}</h3>
                  <p className="home-quad-en">{item.en}</p>
                  <p className="home-quad-detail">{item.detail}</p>
                  <p className="home-quad-metrics">
                    <span>认知测评维度</span>
                    {item.metrics}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section" id="showcase">
          <div className="home-shell">
            <div className="home-section-head home-section-head--row">
              <div>
                <p className="home-eyebrow">
                  <Icon name="compass" size={16} /> Project Showcases
                </p>
                <h2 className="home-section-title">热门沉浸式项目展厅</h2>
                <p className="home-section-lead">
                  以下卡片来自平台真实发布的公开模板（含学科、适龄、难度与阶段安排），
                  登录后即可基于任意模板发起自己的项目。
                </p>
              </div>
              <div className="home-showcase-meta">
                <span className="home-showcase-count">
                  共 {degraded ? '—' : countLabel(templates.length)} 个公开模板
                </span>
                <Link className="home-btn home-btn--ghost" href="/login">
                  登录后探索全部
                  <Icon name="arrowRight" size={18} />
                </Link>
              </div>
            </div>

            <TemplateShowcase templates={templates} />
          </div>
        </section>

        <section className="home-section home-section--deep" id="about">
          <div className="home-shell">
            <div className="home-about-grid">
              <div className="home-about-copy">
                <p className="home-eyebrow">
                  <Icon name="verified" size={16} /> 关于启途智学（QiTu Smart Learning）
                </p>
                <h2 className="home-section-title">
                  源自顶级 AI 实验室，
                  <br />
                  为培育面向智能时代的青年领袖而生
                </h2>
                <p>
                  启途智学由清华大学交叉信息研究院与斯坦福大学学习科技实验室团队成员联合创立。
                  我们坚信：AI 时代的教育核心不是让孩子比拼算力与题库，而是唤醒深植于内心的探究欲、
                  同理心与跨学科工程创造力。
                </p>
                <p>
                  通过自主研发的「苏格拉底认知启发大模型」与「PBL 项目数字工坊」，我们把过去专属高校
                  研讨室的高阶导师制项目研学，普惠给每一个渴望探索的学习者。
                </p>
                <div className="home-about-more">
                  <Link className="home-btn home-btn--ghost" href="/about">
                    了解教育主张与品牌历程
                    <Icon name="arrowRight" size={18} />
                  </Link>
                </div>
                <p className="home-about-footnote">
                  下方数字为平台实时统计口径，随真实使用情况变化。
                </p>
              </div>

              <dl className="home-stat-grid">
                {aboutStats.map((item) => (
                  <div className="home-stat-tile" key={item.label}>
                    <dt>
                      <span className="home-stat-tile-icon" aria-hidden="true">
                        <Icon name={item.icon} size={20} />
                      </span>
                      {item.label}
                    </dt>
                    <dd>
                      <strong>{degraded ? '—' : item.value}</strong>
                      <span>{item.hint}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="home-quotes">
              <h3 className="home-quotes-title">听听来自探索者与家长的真实声音</h3>
              <div className="home-quote-grid">
                {TESTIMONIALS.map((item) => (
                  <figure className="home-quote-card" key={item.name}>
                    <span className="home-stars" aria-label="五星评价">
                      {[0, 1, 2, 3, 4].map((star) => (
                        <Icon name="star" size={15} key={star} />
                      ))}
                    </span>
                    <blockquote>{item.quote}</blockquote>
                    <figcaption>
                      <span className="home-quote-avatar" aria-hidden="true">
                        {item.initial}
                      </span>
                      <span className="home-quote-body">
                        <strong>{item.name}</strong>
                        <span>{item.note}</span>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="home-section" id="contact">
          <div className="home-shell">
            <div className="home-section-head">
              <p className="home-eyebrow home-eyebrow--mint">
                <Icon name="hub" size={16} /> 生态共赢合作
              </p>
              <h2 className="home-section-title">
                与启途智学同行，
                <br />
                共筑未来教育新生态
              </h2>
              <p className="home-section-lead">
                欢迎基础教育学校、高校实验室、研学机构及家庭学习者与我们取得联系，
                我们会为你定制项目式 AI 探索方案。
              </p>
            </div>

            <div className="home-contact-grid">
              <div className="home-contact-aside">
                <ul className="home-contact-list">
                  {CONTACT_ROWS.map((row) => (
                    <li key={row.label}>
                      <span className="home-contact-icon" aria-hidden="true">
                        <Icon name={row.icon} size={20} />
                      </span>
                      <span className="home-contact-body">
                        <strong>{row.label}</strong>
                        <span>{row.value}</span>
                        {row.hint !== undefined ? <em>{row.hint}</em> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="home-contact-note">
                  <Icon name="headset" size={18} />
                  工作日 09:00 - 19:00 在线客服；紧急问题可直接致电课程热线。
                </p>
              </div>

              <div className="home-contact-card">
                <h3>一键预约体验课 / 院校机构合作洽谈</h3>
                <p className="home-contact-card-lead">
                  提交信息后，我们的教育顾问会在 1 个工作日内与你联系，并提供适配的方案建议。
                </p>
                <ConsultationForm />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-shell">
          <div className="home-footer-grid">
            <div className="home-footer-brand">
              <p className="home-brand-name">启途智学</p>
              <p className="home-footer-desc">
                启途智学是专注于下一代认知进化与探究式学习的智能教育平台。融合大语言模型评估、
                生成式 PBL 工坊与多维能力图谱，助力每一位学习者探索热爱、构建未来竞争力。
              </p>
              <p className="home-footer-social" aria-hidden="true">
                <span>
                  <Icon name="forum" size={18} />
                </span>
                <span>
                  <Icon name="mic" size={18} />
                </span>
                <span>
                  <Icon name="share" size={18} />
                </span>
                <span>
                  <Icon name="mail" size={18} />
                </span>
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <nav className="home-footer-col" key={column.title} aria-label={column.title}>
                <h3>{column.title}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith('/') ? (
                        <Link href={link.href}>{link.label}</Link>
                      ) : (
                        <a href={link.href}>{link.label}</a>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}

            <div className="home-footer-col">
              <h3>联系与支持</h3>
              <ul className="home-footer-contact">
                <li>
                  <Icon name="phone" size={16} /> 400-820-9188
                </li>
                <li>
                  <Icon name="mail" size={16} /> partner@qituzhixue.com
                </li>
                <li>
                  <Icon name="location" size={16} /> 西安市雁塔区创智天地科创中心 12 栋
                </li>
                <li>
                  <Icon name="headset" size={16} /> 工作日 09:00 - 19:00 在线客服
                </li>
              </ul>
            </div>
          </div>

          <div className="home-footer-bottom">
            <p>© 2025 启途智学（西安）智能科技有限公司. 保留所有权利。</p>
            <p className="home-footer-legal">
              <span>陕ICP备2024018899号-1</span>
              <span>公网安备 61011302005520号</span>
              <span>服务条款与隐私政策整理中</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
