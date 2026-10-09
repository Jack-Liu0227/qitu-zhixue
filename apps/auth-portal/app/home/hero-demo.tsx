import { Icon } from './icons';

/** 首屏右侧的产品界面预览，不展示虚构的学生对话、统计或版本数据。 */
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
          <span className="home-tutor-title">AI 搭档 · 项目工作区</span>
          <span className="home-tutor-tag">产品预览</span>
        </div>

        <div className="home-tutor-context">
          <span className="home-tutor-context-icon" aria-hidden="true">
            <Icon name="target" size={20} />
          </span>
          <span className="home-tutor-context-body">
            <strong>登录后加载真实项目</strong>
            <span>你的项目目标、对话记录与作品状态会从平台权限范围内加载。</span>
          </span>
        </div>

        <div className="home-thread">
          <div className="home-bubble home-bubble--ai">
            <span className="home-bubble-label">AI 搭档</span>
            <p>登录后，这里会显示与你当前项目相关的引导问题。</p>
          </div>
          <div className="home-bubble home-bubble--me">
            <span className="home-bubble-label">学习者</span>
            <p>你提交的回答、证据与作品会保存在自己的工作区。</p>
          </div>
          <div className="home-bubble home-bubble--ai">
            <span className="home-bubble-label">权限范围内的项目记录</span>
            <p>未登录时不展示任何未成年人真实内容。</p>
          </div>
        </div>

        <div className="home-ladder">
          <div className="home-ladder-head">
            <span>学习流程</span>
            <span>按平台规则逐步推进</span>
          </div>
          <ol className="home-ladder-list">
            <li className="is-done">
              <Icon name="checkCircle" size={16} /> 问题定义 · 从真实任务开始
            </li>
            <li className="is-active">
              <Icon name="sparkle" size={16} /> 理论掌握 · 达标后进入实践
            </li>
            <li>
              <Icon name="target" size={16} /> 作品沉淀 · 记录学习证据
            </li>
          </ol>
        </div>
      </div>

      <div className="home-float home-float--engine">
        <span className="home-float-icon" aria-hidden="true">
          <Icon name="bolt" size={18} />
        </span>
        <span className="home-float-body">
          <strong>项目学习引擎</strong>
          <span>按权限加载项目状态与学习证据</span>
        </span>
      </div>

      <div className="home-float home-float--guard">
        <span className="home-float-icon home-float-icon--mint" aria-hidden="true">
          <Icon name="robot" size={18} />
        </span>
        <span className="home-float-body">
          <strong>苏格拉底式导师</strong>
          <span>理论达标后解锁实践阶段</span>
        </span>
      </div>
    </div>
  );
}
