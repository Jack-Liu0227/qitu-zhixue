import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@qitu/ui';
import './about.css';

export const metadata: Metadata = {
  title: '关于我们｜启途智学',
  description: '启途智学，面向10–18岁学生的项目式AI学习平台。让好奇发生，让成长留下。',
};

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="header shell">
      <Link className="brand" href="/" aria-label="启途智学首页"><span className="logo" aria-hidden="true"><BrandMark size={40} decorative /></span><span>启途智学</span></Link>
      <nav aria-label="主导航"><Link href="/">首页</Link><Link className="active" href="/about" aria-current="page">关于我们</Link></nav>
      <Link className="login-button" href="/login">登录 <span aria-hidden="true">↗</span></Link>
      </header>
      <main>
      <section className="about-hero shell">
      <div className="hero-intro reveal visible"><h1>让好奇发生，<br />让<span>成长留下。</span></h1><p>每一个“为什么”，<br />都可能是一段了不起的旅程的开始。</p><a className="text-link" href="#who">认识启途智学 <span>↓</span></a></div>
      <div className="exploration-art reveal delay-1 visible" aria-label="从一个问题，经过探索，完成自己的作品">
      <div className="exploration-grid" aria-hidden="true"></div>
      <div className="exploration-top"><span><i></i> 一段成长，正在发生</span><small>01 → 02 → 03</small></div>
      <div className="wonder-note"><span>从一个问题出发</span><p>“我能为校园里的小鸟，<br />设计一个家吗？”</p><b aria-hidden="true">↗</b></div>
      <div className="project-sheet"><div className="sheet-heading"><span>我的探索项目</span><small>PROJECT 001</small></div><h3>给小鸟，造一个家。</h3><p>观察自然 · 理解需求 · 动手设计</p>
      <div className="birdhouse-art" aria-hidden="true"><svg viewBox="0 0 320 200"><circle className="sun" cx="246" cy="43" r="22"/><path className="hill" d="M0 170Q85 126 161 164T320 155V200H0Z"/><path className="stem" d="M75 183v-36m0 19-13-12m13 3 12-15M267 183v-48m0 20-13-13m13 22 12-13"/><path className="post" d="M160 123v64"/><path className="house" d="M112 88l48-42 48 42v61h-96Z"/><path className="roof" d="m101 89 59-52 59 52"/><circle className="hole" cx="160" cy="99" r="16"/><path className="perch" d="M149 126h22"/><path className="bird" d="M234 106c-14-1-23 11-18 20 7 10 25 6 29-6l10-3-11-4q-2-6-10-7Z"/><circle cx="237" cy="114" r="1.5" fill="#324a68"/><path className="wing" d="m220 118 12 5 5-7"/></svg></div>
      <div className="sheet-footer"><span>✓ 观察记录</span><span>✓ 设计草图</span><span className="sheet-current">✦ 我的作品</span></div></div>
      <div className="mentor-note"><span className="mentor-star" aria-hidden="true">✦</span><div><b>AI 导师，陪你再想一步</b><p>小鸟的家，要怎样挡住雨水呢？</p></div></div>
      <div className="growth-pill"><span>✧</span> 每一次尝试，都有成长。</div>
      </div>
      </section>
      <section id="who" className="who-section shell reveal visible">
      
      <div className="who-content">
      <h2>不是替孩子给出答案，<br />而是陪他<span>走向自己的答案。</span></h2>
      <div className="who-description">
      <p className="who-lead">启途智学，是一个面向 <strong>10–18 岁学生</strong>的<br className="intro-break" />项目式 AI 学习平台。</p>
      <p>孩子从一个问题、一个兴趣或一个想法出发，和 AI 导师持续对话，在真实项目中学习知识，做出作品。</p>
      <p>真人班主任陪伴过程，在需要帮助的时候及时介入。</p>
      </div>
      <div className="who-belief">学习不只是获得知识，<br />更是发现<strong>自己能够做什么。</strong></div>
      </div>
      
      </section>
      <section className="why-section">
      <div className="shell why-inner">
      <div className="why-heading reveal visible"><h2>孩子并不是不喜欢学习。<br />也许，只差一个<br /><span>真正想弄明白的问题。</span></h2></div>
      <div className="curiosity-grid"><div className="curiosity-card reveal visible"><span>01 / 仰望</span><b>“星星为什么<br />不会掉下来？”</b><svg viewBox="0 0 160 90" aria-hidden="true"><path d="m90 12 5 15 16 1-12 10 4 16-13-9-13 9 4-16-12-10 16-1Z"/><circle cx="30" cy="60" r="2"/><circle cx="130" cy="70" r="2"/><path d="M15 80Q80 42 150 80"/></svg></div><div className="curiosity-card reveal delay-1 visible"><span>02 / 想象</span><b>“我能写一个<br />不一样的故事吗？”</b><svg viewBox="0 0 160 90" aria-hidden="true"><path d="M40 72V20q20-8 40 4 20-12 40-4v52q-20-8-40 4-20-12-40-4Zm40-48v52M48 32l22 5M48 44l22 5M90 38l20-5M90 50l20-5"/></svg></div><div className="curiosity-card reveal delay-2 visible"><span>03 / 改变</span><b>“校园的小麻烦，<br />我能做点什么？”</b><svg viewBox="0 0 160 90" aria-hidden="true"><path d="M65 61c0-9-17-14-17-30a30 30 0 0 1 60 0c0 16-17 21-17 30M64 65h28M67 73h22M73 81h10M78 16v20m-9-10 9 10 9-10"/></svg></div></div>
      <p className="why-closing reveal visible">我们希望，这些问题不会被轻轻带过。<br />在这里，还不完整的念头，也值得被认真对待。</p></div>
      </section>
      <section className="journey-section shell">
      <div className="journey-heading reveal visible"><h2>学习，<br />从一个<span>想法</span>开始。</h2><p>不急着找到标准答案。<br />先让孩子找到真正愿意探索的事。</p></div>
      <div className="journey-steps">
      <article className="step reveal visible"><span className="step-number">01</span><div><small>DISCOVER</small><h3>先找到想做的事</h3><p>从兴趣和问题出发，选择一个真正愿意了解的主题。一个日常观察，一次突发奇想，都可以成为起点。</p></div><span className="step-symbol" aria-hidden="true">↗</span></article>
      <article className="step reveal visible"><span className="step-number">02</span><div><small>EXPLORE</small><h3>再和 AI 一起弄明白</h3><p>AI 导师解释知识、补充资料，也会根据孩子的理解程度，一步步提出问题和建议，让思考继续往前走。</p></div><span className="step-symbol" aria-hidden="true">✳</span></article>
      <article className="step reveal visible"><span className="step-number">03</span><div><small>CREATE</small><h3>边对话，边完成项目</h3><p>孩子说出想法，AI 帮助梳理内容、设计步骤。通过选择、补充和修改，让项目逐渐成形。不要求孩子自己写程序，更重要的是表达与判断。</p></div><span className="step-symbol" aria-hidden="true">⌁</span></article>
      <article className="step reveal visible"><span className="step-number">04</span><div><small>GROW</small><h3>最后，留下自己的作品</h3><p>一篇研究报告、一段故事、一份设计，或任何亲手完成的成果，都成为孩子看得见、讲得出的成长记录。</p></div><span className="step-symbol" aria-hidden="true">✦</span></article>
      </div></section>
      <section className="companions-section shell"><h2 className="reveal visible">AI 陪在身边，<br /><span>孩子自己做主。</span></h2><div className="companions-grid"><article className="companion ai-companion reveal visible"><div className="companion-mark" aria-hidden="true">✳</div><span className="label">AI MENTOR</span><h3>随时回应，陪他探索。</h3><p>AI 导师回应问题，帮助理解、思考和推进。反复提问、大胆尝试，都有耐心的回应。</p></article><article className="companion human-companion reveal delay-1 visible"><div className="companion-mark" aria-hidden="true">♡</div><span className="label">HUMAN SUPPORT</span><h3>关键时刻，真人在场。</h3><p>班主任关注孩子的状态。当他长时间卡住、缺少信心，或需要更深入的交流时，及时鼓励和引导。</p></article></div><p className="autonomy-note reveal visible">陪伴不是替代。<strong>每一次选择和表达，都来自孩子自己。</strong></p></section>
      <section className="parent-section"><div className="shell parent-inner"><div className="growth-art reveal visible" aria-hidden="true"><div className="growth-paper"><span>MY LEARNING JOURNEY</span><h4>从“我不知道”<br />到“我试试看”</h4><div className="growth-row"><i>?</i><div><b>提出一个问题</b><small>好奇，是一切的开始</small></div></div><div className="growth-row"><i>↗</i><div><b>尝试新的方向</b><small>思考，也会有转弯</small></div></div><div className="growth-row"><i>✓</i><div><b>完成我的作品</b><small>每一步，都算数</small></div></div><div className="growth-stamp">成长<br />有迹可循</div></div></div><div className="parent-copy reveal visible"><h2>看到作品，<br />也看到<span>作品背后的孩子。</span></h2><p>孩子正在研究什么，经历了哪些尝试，最终留下了怎样的作品与进步记录——这些成长，都可以被看见。</p><p>你看到的不只是结果，还有他如何提出问题，如何改变想法，如何从“我不知道”走到“我试试看”。</p></div></div></section>
      <section className="vision-section shell"><h2 className="reveal visible">愿每个孩子，<br />都有一段<span>属于自己的学习旅程。</span></h2><p className="reveal visible">从一个小小的问题出发，<br />在一次次对话与尝试中，看见自己的兴趣、能力和方向。</p><blockquote className="reveal visible">“这是我想出来的，<br />也是我一步步做出来的。”</blockquote><span className="vision-caption reveal visible">我们期待听到的，不只是正确答案，而是这样的声音。</span></section>
      <section className="about-cta shell reveal visible"><div><h2>从一个问题开始。</h2><p>带着好奇，和 AI 一起，把想法慢慢做成作品。</p></div><Link href="/login">开启学习旅程 <span aria-hidden="true">↗</span></Link></section>
      </main>
      <footer className="about-footer shell"><Link className="brand" href="/" aria-label="启途智学首页"><span className="logo" aria-hidden="true"><BrandMark size={40} decorative /></span><span>启途智学</span></Link><span>让好奇发生，让成长留下。</span><small>© 2026 启途智学</small></footer>
    </div>
  );
}
