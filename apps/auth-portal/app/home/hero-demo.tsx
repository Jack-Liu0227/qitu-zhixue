import { Icon } from './icons';

/**
 * 首屏右侧的「AI 搭档」界面示意。
 *
 * 这是**界面示意**，不是实时数据：卡片右上角固定标注「界面示例」，
 * 避免访客把它当成真实学生对话（未成年人的对话内容也不会出现在公开页面上）。
 */
export function HeroTutorDemo() {
  return (
    <div className="home-hero-visual">
      <div className="home-tutor-card">
        <div className="home-tutor-bar">
          <span className="home-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="home-tutor-title">AI 搭档 · 火星生态居住舱智能调控</span>
          <span className="home-tutor-tag">界面示例</span>
        </div>

        <div className="home-tutor-context">
          <span className="home-tutor-context-icon" aria-hidden="true">
            <Icon name="target" size={20} />
          </span>
          <span className="home-tutor-context-body">
            <strong>本轮目标</strong>
            <span>让舱内氧气浓度在 8 分钟内回到安全区间，并说明依据</span>
          </span>
        </div>

        <div className="home-thread">
          <div className="home-bubble home-bubble--ai">
            <span className="home-bubble-label">AI 搭档</span>
            <p>你打算先测哪一个变量？说说你的理由。</p>
          </div>
          <div className="home-bubble home-bubble--me">
            <span className="home-bubble-label">学生</span>
            <p>先调氧气浓度，因为它直接影响能不能生存。</p>
          </div>
          <div className="home-bubble home-bubble--ai">
            <span className="home-bubble-label">AI 搭档 · 第 2 层追问</span>
            <p>如果只动氧气、不管二氧化碳，8 分钟后浓度会怎么变？先预测，再动手验证。</p>
          </div>
        </div>

        <div className="home-ladder">
          <div className="home-ladder-head">
            <span>提示阶梯</span>
            <span>答案始终不直接给出</span>
          </div>
          <ol className="home-ladder-list">
            <li className="is-done">
              <Icon name="checkCircle" size={16} /> 第 1 层 · 定位概念：气体浓度与换气速率
            </li>
            <li className="is-active">
              <Icon name="sparkle" size={16} /> 第 2 层 · 类比例子：像给鱼缸换水
            </li>
            <li>
              <Icon name="target" size={16} /> 第 3 层 · 拆解步骤：尚未解锁
            </li>
          </ol>
        </div>
      </div>

      <div className="home-float home-float--engine">
        <span className="home-float-icon" aria-hidden="true">
          <Icon name="bolt" size={18} />
        </span>
        <span className="home-float-body">
          <strong>QuestED Engine v3.4</strong>
          <span>启发式状态机 · 已识别 3 个卡点，全程未泄露答案</span>
        </span>
      </div>

      <div className="home-float home-float--guard">
        <span className="home-float-icon home-float-icon--mint" aria-hidden="true">
          <Icon name="robot" size={18} />
        </span>
        <span className="home-float-body">
          <strong>苏格拉底式导师</strong>
          <span>掌握度 62% → 目标 85% 才解锁实践阶段</span>
        </span>
      </div>
    </div>
  );
}
