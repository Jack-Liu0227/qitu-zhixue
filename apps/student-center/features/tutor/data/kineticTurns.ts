import type { TutorTurn } from '@qitu/contracts';

export interface ChatSessionItem {
  id: string;
  title: string;
  teamId: 'team-thunder-fighter' | 'team-kinetic-energy';
  updatedAt: string;
  isArchived: boolean;
  turns: TutorTurn[];
}

export const KINETIC_ENERGY_TURNS: TutorTurn[] = [
  {
    turnId: 'ke-turn-1',
    role: 'assistant',
    blocks: [
      {
        kind: 'pbl_card',
        phase: 'concept_mastery',
        title: '项目阶段二：动能定理核心原理推导（苏格拉底式 PBL 探究）',
        teammateLabel: '⚡ 苏格拉底原理教练 (Coach)',
        summary: '欢迎进入《动手学动能定理》探究项目！在进入虚拟物理实验室编写仿真代码前，我们必须通过思维实验与数学推导，彻底搞清楚外力做功与动能改变的本质关联。',
        tags: ['牛顿第二定律', '功的定义式 W=Fs', '动能定理推导与门禁'],
        actionLabel: '开始思维实验',
      },
      {
        kind: 'think',
        content: '学生已进入高中物理动能定理探究。遵循工程与教学硬规则：在 TheoryMastered 门禁达成之前，绝对不能解锁代码实践阶段。必须采用苏格拉底产婆术，从最基础的小车受力与运动学公式逐步引导学生自主发现规律。',
        closed: true,
      },
      {
        kind: 'tool',
        call: {
          callId: 'call-ke-gate-check',
          name: 'verify_theory_mastered_gate',
          label: '检查学生动能定理掌握度门禁状态',
          status: 'done',
          result: '理论评估中：未达 TheoryMastered，保持概念启发式引导模式',
        },
      },
      {
        kind: 'questions',
        items: [
          '设想一辆质量为 m 的小车，在光滑水平面上受到一个恒定外力 F 的持续推动。根据牛顿第二定律，小车的加速度 a 是多少？',
          '在位移 s 的过程中，恒力 F 对小车做了多少功？它的定义公式是什么？',
        ],
      },
    ],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_learning',
    seq: 1,
    createdAt: '2026-10-12T01:00:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'ke-turn-2',
    role: 'student',
    blocks: [
      {
        kind: 'text',
        text: '根据牛顿第二定律，加速度 a = F / m；恒力做的功定义式是 W = F · s。',
      },
    ],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: 2,
    createdAt: '2026-10-12T01:01:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'ke-turn-3',
    role: 'assistant',
    blocks: [
      {
        kind: 'think',
        content: '学生基础物理定义掌握准确无误。下一步：引导学生将运动学中速度与位移公式（v2^2 - v1^2 = 2as）与功的定义式进行代数联立，观察推导出的结果。',
        closed: true,
      },
      {
        kind: 'text',
        text: '回答完全正确！非常扎实的力学功底。\n\n现在请回忆匀变速直线运动中不含时间 t 的速度-位移关系式：\n\n$$v_2^2 - v_1^2 = 2as$$\n\n如果我们将 $a = \\frac{F}{m}$ 代入这个公式，并解出恒力做的功 $W = F \\cdot s$，两边会发生什么奇妙的数学变化？',
      },
      {
        kind: 'options',
        items: [
          { label: 'A', text: '两边同时乘以 1/2 m，得到 W = 1/2 m v2² - 1/2 m v1²' },
          { label: 'B', text: '位移 s 与速度成正比，功 W 仅仅等于 m·v' },
          { label: 'C', text: '力 F 会完全抵消，功恒等于零' },
        ],
        allowOther: false,
      },
    ],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_learning',
    seq: 3,
    createdAt: '2026-10-12T01:02:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'ke-turn-4',
    role: 'student',
    blocks: [
      {
        kind: 'text',
        text: '我选 A！把 a = F/m 代进去：v2² - v1² = 2(F/m)s，移项后 F·s = 1/2 m v2² - 1/2 m v1²，左边刚好就是合外力做的功 W！',
      },
    ],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: 4,
    createdAt: '2026-10-12T01:03:00.000Z',
    modality: 'text',
  },
  {
    turnId: 'ke-turn-5',
    role: 'assistant',
    blocks: [
      {
        kind: 'think',
        content: '精彩！学生已完全自主完成了动能定理的核心代数推导。此时应由评审导师 (Reviewer) 给出严谨认定，并调用沙箱工具输出动能定理的物理图景与验证脚本，同时提示满足 TheoryMastered 准入门禁！',
        closed: true,
      },
      {
        kind: 'tool',
        call: {
          callId: 'call-physics-sandbox-ke',
          name: 'python_physics_sandbox',
          label: '在 Python 沙箱中运行动能定理数值模拟 (RK4 积分检验)',
          status: 'done',
          result: '数值模拟通过：恒力做功 W = 50.0 J，动能变化量 ΔEk = 50.0 J，能量守恒相对误差 < 1e-6',
        },
      },
      {
        kind: 'text',
        text: '太漂亮了！你自己亲手推导出了物理学中最伟大的定律之一——**动能定理 (Work-Energy Theorem)**！\n\n$$W_{\\text{合}} = \\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2$$\n\n我们把 $\\frac{1}{2}mv^2$ 定义为物体的**动能 ($E_k$)**。合外力对物体所做的功，等于物体动能的变化量！',
      },
      {
        kind: 'evidence',
        ref: '高中物理必修第二册 · 第八章 机械能守恒定律 · 动能与动能定理',
      },
      {
        kind: 'interactive_experiment',
        experimentId: 'exp-kinetic-work-energy',
        title: '动能定理参数动态探究工作台',
        summary: '控制变量法探究：调节小车质量 m 与位移 s，观察做功与动能增量的动态关联。',
      },
      {
        kind: 'quiz',
        questionId: 'quiz-ke-gate',
        stem: '【门禁考核】如果一个质量为 2kg 的小球初始速度为 3m/s，受到合外力做功 16J 后，小球的末速度为多少？',
        type: 'heuristic',
        options: [
          { key: 'A', text: '4 m/s', hint: '注意：初动能 Ek1 = 1/2 * 2 * 3^2 = 9J，做功 16J 后末动能 Ek2 = 25J！' },
          { key: 'B', text: '5 m/s', hint: '完全正确！Ek2 = 1/2 * 2 * v2^2 = 25J，解得 v2 = 5 m/s！' },
          { key: 'C', text: '7 m/s', hint: '速度不是直接相加噢，动能与速度的平方成正比！' },
        ],
        explanation: '初动能 Ek1 = 1/2 * 2 * 3² = 9 J。合外力做功 W = 16 J，末动能 Ek2 = Ek1 + W = 25 J。因为 Ek2 = 1/2 * 2 * v2² = v2²，所以 v2 = 5 m/s。',
      },
      {
        kind: 'artifact',
        fileName: 'kinetic_energy_simulation.py',
        fileType: 'code',
        title: '动能定理物理数值仿真验证脚本',
        summary: '基于 Python 沙箱的数值检验程序，模拟小车在合外力作用下的做功与动能实时转换曲线。',
        content: `import numpy as np

def verify_work_energy_theorem(mass=2.0, F=10.0, s=5.0, v0=0.0):
    """
    数值验证合外力做功与动能变化量定理:
    W = F * s
    ΔEk = 1/2 * m * v^2 - 1/2 * m * v0^2
    """
    # 1. 恒力做功计算
    W = F * s
    
    # 2. 运动学末速度
    a = F / mass
    v_final = np.sqrt(v0**2 + 2 * a * s)
    
    # 3. 动能变化量计算
    Ek_initial = 0.5 * mass * (v0**2)
    Ek_final = 0.5 * mass * (v_final**2)
    delta_Ek = Ek_final - Ek_initial
    
    print(f"合外力做功 W = {W:.2f} J")
    print(f"动能变化量 ΔEk = {delta_Ek:.2f} J")
    print(f"两者是否相等: {np.isclose(W, delta_Ek)}")
    return np.isclose(W, delta_Ek)

if __name__ == '__main__':
    verify_work_energy_theorem()
`,
        sizeText: '1.2 KB',
        nodeRef: '动能定理门禁达标',
      },
    ],
    hintLevel: null,
    stageBefore: 'theory_learning',
    stageAfter: 'theory_check',
    seq: 5,
    createdAt: '2026-10-12T01:04:00.000Z',
    modality: 'text',
  },
];
