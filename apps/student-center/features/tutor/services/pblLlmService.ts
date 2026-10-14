/**
 * PBL 导师大模型实时接入与调度服务
 * 支持 OpenAI 兼容协议（DeepSeek、阿里通义、Kimi、智谱、Ollama、LocalAI 等）
 * 以及服务端统一模型网关调用。
 */

export interface LlmConfig {
  provider: 'server' | 'deepseek' | 'qwen' | 'openai' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: 'server',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.7,
};

const STORAGE_KEY = 'qitu.llm.client_config';

export function getClientLlmConfig(): LlmConfig {
  if (typeof window === 'undefined') return DEFAULT_LLM_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_LLM_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_LLM_CONFIG;
}

export function saveClientLlmConfig(config: LlmConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export interface PblLlmReplyResult {
  think: string;
  text: string;
  questions?: string[];
  options?: Array<{ label: string; text: string }>;
  modelSource: string;
}

/**
 * 调用大语言模型生成苏格拉底式情景教学回复
 */
export async function generatePblLlmResponse({
  teamId,
  agentName,
  agentRole,
  studentMessage,
  history,
}: {
  teamId: string;
  agentName: string;
  agentRole: string;
  studentMessage: string;
  history: Array<{ role: 'student' | 'assistant'; text: string }>;
}): Promise<PblLlmReplyResult> {
  const isKinetic = teamId === 'team-kinetic-energy';
  const topicName = isKinetic
    ? '《动手学动能定理 —— 从做功推导到数值仿真》'
    : '《雷霆战机游戏架构设计与碰撞检测》';

  const systemPrompt = `你现在是启途智学（Qitu Zhixue）平台的高级 AI 导师：【${agentName}】（角色职责：${agentRole}）。
你正在带领中小学生开展 PBL 项目式情景教学，当前探究课题为：${topicName}。

【必须严格执行的教学铁律】：
1. 绝对禁止直接给出完整代码、直接代数算式答案或直接替代学生思考。
2. 严格采用苏格拉底式提问引导：通过情景设问、反例启发、生活隐喻，拆解复杂的物理定律或游戏循环概念，促使学生自主思考并给出回答。
3. 遵循平台门禁：在学生未充分推导并掌握理论（TheoryMastered）前，不得跳转到代码制作阶段。
4. 语言亲切、富于鼓励、富有启发性，适合青少年学生理解。

【输出排版格式规范】：
1. 你的导师教学意图推演请务必包裹在 <think> ... </think> 标签中，说明你本轮的启发逻辑与意图澄清策略。
2. 物理公式统一采用 LaTeX 语法，例如 $W = F \\cdot s$ 或 $$W_{\\text{合}} = \\Delta E_k$$。
3. 回复的正文结构：
   - 先对学生的思考予以精准肯定和解析；
   - 给出核心启发推导或情景实验设问；
   - 在文末以 1-2 个清晰具体的思考题结尾；
   - 若本轮适合学生做出决策（如确认课题、继续澄清、调整参数等），请在文末另起一行以 JSON 格式输出建议选项，格式如：
   [OPTIONS: [{"label": "选项A", "text": "详情说明"}, {"label": "选项B", "text": "详情说明"}]]`;

  const config = getClientLlmConfig();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((h) => ({
      role: h.role === 'student' ? 'user' : 'assistant',
      content: h.text,
    })),
    { role: 'user', content: studentMessage },
  ];

  // 1. 若配置了自定义或在线大模型 API Key，发起真实请求
  if (config.apiKey && config.apiKey.trim().length > 5) {
    try {
      const endpoint = `${config.baseUrl.replace(/\/$/u, '')}/chat/completions`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: 1500,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const rawContent = json?.choices?.[0]?.message?.content ?? '';
        if (rawContent.trim()) {
          return parseLlmOutput(rawContent, `${config.model} (真实接入)`);
        }
      }
    } catch {
      // 真实网络失败时静默降级到服务端/内核仿真
    }
  }

  // 2. 尝试调用平台后端模型网关 /api/v1/model-registry/complete
  try {
    const res = await fetch('/api/v1/tutor/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamId,
        agentRole,
        messages,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data?.content) {
        return parseLlmOutput(json.data.content, '启途底座网关');
      }
    }
  } catch {
    // ignore
  }

  // 3. 兜底内核规则引擎（确保即便无网络/无Key时也拥有完美 PBL 教学体验）
  return generateFallbackPblReply(isKinetic, studentMessage, agentRole);
}

function parseLlmOutput(raw: string, source: string): PblLlmReplyResult {
  let think = '';
  let text = raw;
  const options: Array<{ label: string; text: string }> = [];
  const questions: string[] = [];

  // 提取 <think>...</think>
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    think = thinkMatch[1]!.trim();
    text = raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
  }

  // 提取 [OPTIONS: [...]]
  const optionsMatch = text.match(/\[OPTIONS:\s*(\[[\s\S]*?\])\s*\]/i);
  if (optionsMatch) {
    try {
      const parsedOpts = JSON.parse(optionsMatch[1]!);
      if (Array.isArray(parsedOpts)) {
        options.push(...parsedOpts);
      }
    } catch {
      // ignore
    }
    text = text.replace(/\[OPTIONS:\s*\[[\s\S]*?\]\s*\]/i, '').trim();
  }

  // 兜底提取结尾问题
  const lines = text.split('\n');
  const questionLines = lines.filter((l) => l.trim().startsWith('1.') || l.trim().startsWith('2.') || l.trim().includes('？'));
  if (questionLines.length > 0 && questionLines.length <= 3) {
    questions.push(...questionLines.map((q) => q.replace(/^\d+\.\s*/, '').trim()));
  }

  return {
    think: think || '【导师策略】：已根据 PBL 教学框架与当前提问生成自适应启发式引导。',
    text,
    options: options.length > 0 ? options : undefined,
    questions: questions.length > 0 ? questions : undefined,
    modelSource: source,
  };
}

function generateFallbackPblReply(
  isKinetic: boolean,
  content: string,
  agentRole: string
): PblLlmReplyResult {
  const isConfirmation = content.includes('确认') || content.includes('选 A') || content.includes('继续');
  const isFormula = content.includes('W') || content.includes('F') || content.includes('ma') || content.includes('做功') || content.includes('速度');

  if (agentRole === 'Intake Guide' || !isConfirmation) {
    return {
      think: `【启途智学助手·意图澄清】：学生输入了「${content}」。按照 PBL 规范，尚未正式立项前需进一步明确成果形态与探究边界。`,
      text: isKinetic
        ? `你好！我是你的启途智学助手。很高兴看到你对「${content}」产生兴趣！\n\n在我们正式立项前，我想澄清你的探究目标：\n1. 你是想探究汽车刹车与制动距离的力学机制，还是想严密推导出动能定理核心公式？\n2. 最终成果你更倾向于完成一份理论推导报告，还是编写一个 Python 倾斜轨道数值仿真动画？\n\n我为你推荐课题：《动手学动能定理 —— 从做功推导到数值仿真》。确认意图后我们将召唤物理导师团队接管教学！`
        : `你好！我是你的启途智学助手。听到你对「${content}」感兴趣，太让人期待了！\n\n在我们正式立项前，我想澄清你的探究目标：\n1. 你是想攻克 Pygame 游戏引擎的主循环机制，还是想掌握几何碰撞检测算法？\n2. 预计作品要包含战机射击与敌人生成逻辑吗？\n\n我为你推荐课题：《雷霆战机游戏架构设计与碰撞检测》。确认意图后我们将召唤游戏导师团队接管教学！`,
      options: [
        { label: '确认课题', text: isKinetic ? '确认选择《动手学动能定理》课题，开启项目探究' : '确认选择《雷霆战机游戏架构》课题，开启项目探究' },
        { label: '继续澄清', text: '我想再微调一下研究方向，换个更有挑战性的角度' },
      ],
      modelSource: 'PBL情境内核',
    };
  }

  return {
    think: `【概念推导教练·苏格拉底导引】：学生关注了「${content}」。引导其联立受力公式与位移积分推导出动能定理。`,
    text: isKinetic
      ? `非常棒的切入点！我们沿着这个方向深入一步：\n\n1. 当小车受恒定合力 $F$ 在光滑地面上位移 $s$ 时，力所做的功为：\n$$W = F \\cdot s$$\n2. 结合牛顿第二定律 $F = m a$ 与运动学公式 $v_2^2 - v_1^2 = 2 a s$：\n$$a s = \\frac{1}{2}(v_2^2 - v_1^2)$$\n\n将它们代入联立，你能发现合外力做功与末动能、初动能之间有什么神奇的对应关系吗？`
      : `很棒！我们来看看雷霆战机的主循环结构：\n\`\`\`python\nwhile running:\n    handle_input()   # 1. 监听键盘左右按键\n    update_physics() # 2. 更新飞机与敌机位置\n    check_collision()# 3. 几何包围盒相交检测\n    render_screen()  # 4. 刷新画布\n\`\`\`\n如果想保证子弹飞行的手感丝滑，你觉得每一帧计算位移时，是直接加固定像素好，还是乘以每帧耗时 $\\Delta t$ 更好？`,
    options: [
      { label: '推导公式', text: '联立 W = m(as)，导出动能增量等于合外力做功' },
      { label: '进入仿真', text: '我想在 RK4 物理数值沙箱中观察小车受力与速度曲线' },
    ],
    modelSource: 'PBL情境内核',
  };
}
