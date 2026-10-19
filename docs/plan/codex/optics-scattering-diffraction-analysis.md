# 光学 PBL 的模型、互动与证据边界

> 状态：新 16 节模板与实际正文草稿生成已有源码，本地全量离线复核已通过；可视化仍为原型，正式 action/observations/CER 闭环未完成。2026-10-19。
> [课时合同](./theme-session-team-ima-design.md) 规定版本与排期；[实施计划](./implementation-plan.md) 规定交付次序。本文不新增掌握度目标或独立实验状态机。

## 1. 目标与现状

光学基线有 12 个排程目标、4 个阶段、4 个质化波动模块，包含单缝衍射与散射。散射/衍射属于实践中的非门禁模块，理论门禁仍是已有 TheoryMastered，不因第 8 节到来自动通过。

本轮新增 `OPTICS_16_SESSION_TEMPLATE_SPEC`，模板 `pbl-optics-inquiry-16s@v2-16s`、profile `optics-16x60-v2`。新 slug `optics-physical-inquiry-16s` 消费实际版本正文生成草稿；bootstrap key `optics-physical-inquiry:16s-v2` 需显式 `--curriculum-16s`，默认旧 v1 不变。新课时有稳定 ID 与检查点，8/14/16 不自动判通过。反思 block kind、课时标题与活动指导已接入保存/回读，0036 迁移未部署。profile/content digest/Skills 未冻结，不把新教案源码称为正式实验上线。

`optics_experiment` 是结构化可视化原型。现有安全渲染和物理回退不等于正式证据协议接通。TheoryMastered 前只允许低风险模拟提示；正式模拟/真实实践工具都要再次校验对象权限、门禁、实验版本和参数域。

不改学生导航。AI搭档 `/student/tutor` 承担连续探究，灵感空间 `/student/inspiration` 保留探索跳转。Board、Mermaid、KaTeX 和注册实验卡按任务需要展示，不能把长文灌输改成更多动画后就称为自适应。

## 2. 首个完整教学任务

驱动问题：保持光源与屏距不变，窄缝宽度改变时中央亮纹会如何变化，我们能用哪些可复核读数说明？

1. 学生记录现象与原始预测，不先展示可抄结论。
2. 导师追问自变量、因变量和控制变量。
3. owner 签发当前 task 的实验 action，校验后调用注册单缝模型。
4. 学生读图并保存模拟观察，记录参数、单位、模型版本和来源类别。
5. 数据导师只根据已有 observation IDs 引导比较、趋势和误差。
6. 学生写 CER，评审导师指出缺口；作品通过由 works/feedback owner 决定。
7. 反思导师追问原预测如何改变，保留失败假设作为探究证据。

“缝越窄，亮纹越窄”的误解先用单变量对照澄清。混淆宽度与亮度时分别定义观测量。求助不自动判错；提示阶梯给方法或相似例子，不泄活动题答案或代写终稿。明确次数阈值属于待审核策略，不能把历史方案里的“两次独立完成”当普遍学习规律。

## 3. 注册模型和定量域

### 单缝衍射

首期只支持远场、单色、理想单缝。暗纹条件和屏上几何位置为：

```text
a sin(theta_m) = m lambda
y_m = D tan(arcsin(m lambda / a))
central width = 2 y_1

small-angle approximation: central width ~= 2 lambda D / a
I(theta) / I0 = (sin(beta) / beta)^2
beta = pi a sin(theta) / lambda
```

`beta = 0` 取连续极限 1。只有远场条件和小角条件满足才使用对应定量模式；滑块范围不自动证明近似有效。单位先规范化，波长在真空或介质内的约定必须记录。归一化强度不等于绝对亮度，也不证明总能量不变。

模型计算回归样例：`lambda=632.8 nm, a=50 um, D=1 m` 的小角中央宽度为 `25.312 mm`，缝宽加倍应近似减半。该数字由公式可复算，不是实测或学习效果。50 um 不是普遍衍射可见阈值，分辨性还取决于波长、几何和仪器/显示分辨率。

性质测试覆盖对称性、暗纹、连续极限、单位、变量趋势、采样分辨率和域外拒绝。不能为使图像“看起来合理”静默夹紧参数或临时换未验证模型。

### 封闭细雾室散射

首期重在有雾/无雾、观察方向与入射光谱的定性比较。尺寸参数使用介质内波长时为 `x = 2 pi r / lambda`；真空波长时为 `x = 2 pi n_medium r / lambda0`，不能混用。

Rayleigh 的 `lambda^-4` 比较只用于批准的小粒子模型域和相同其他条件。域外不继续套用，也不能统一标为“白色 Mie”。完整散射还受折射率、粒径分布和角度等影响，两个滑块不足以支持普遍精密结论。单色入射的弹性散射不会凭空变白；域外显示本模型不作定量判断。

模型域由审核版本和测试定义，不由模型在回答中临时选择。真实实验另需教师安全审核、安全外壳、材料、光源等级和操作方案。护目镜提醒不能代替安全方案，禁止提供直视、开放光束或不安全激光操作指令。

## 4. action、观测与作品引用合同

以下为接入需求，尚不是已发布 endpoint。复用已有 plan/action/evidence/works owner，在正式 contracts 统一类型与错误码。

| 数据 | 由谁决定 | 必需信息 |
| --- | --- | --- |
| action 实例 | 服务端签发 | 稳定 action ID、actor/project/session/task/revision、实验/specVersion、目标、期限和允许操作 |
| 学生请求 | 客户端有限输入 | action ID、base revision、有界参数/预测/观察，header 幂等键 |
| 模型计算 | 注册 handler | 批准模型版本、有限数值/单位、域校验、确定性结果 |
| observation | evidence owner | 原预测、配置、模型版本、来源类别、学生读数、event ID 与 revision |
| CER/作品 | works/feedback | 作品版本、实际 observation IDs、冻结 rubric 和授权引用 |

project、assistant、objective、gate、保存时间和完成事实不能由客户端/模型自报可信。拒绝 actionKind=`run` 充当稳定 action ID。跨项目、过期 revision、伪目标、越界/NaN 参数和不相容模型在执行前拒绝。

同幂等键重放返回同一个 owner 回执，不能重复观察、判分或计划 revision。断线后能读取已接受结果并继续，不把未确认请求显示为已保存。普通聊天摘要只表示发给 AI搭档，不伪装为作品证据。

来源明确区分“模型计算”“模拟观察”“真实测量”。教材引用支持解释，但不能替代学生观察；不补造页码、仪器、误差或读数。图片/曲线的存在本身不产生 TheoryMastered、作品通过或成长事实。

## 5. 动态生成与安全渲染

大纲、当前课时和逐轮追问都应消费实际冻结内容与已有证据。模型生成教学候选，注册模型负责计算。学生回答不同可触发澄清、单变量比较、同目标补救或迁移问题，但不能改变必做目标与门禁。

一次前台导师、按需后台核验；身份和真实模型取同一 resolver。交互块必须先 schema 校验、owner 接受和 action 签发，才显示可操作。Mermaid 用安全模式、KaTeX 不开启 trust、Board 使用闭集，不生成任意 HTML/JS 或外链脚本。

首批 Tutor/SDK 已统一真实助手的当前身份、模型 pair、skills/tools、trace 和当前 IMA 授权，SDK 每轮回读 hash/pair；当前教学源为 Admin assistant 字段。历史能力制品与 Worker 工具闭包未接，不能仅凭当前身份一致声称上述实验操作已获项目级授权。

## 6. 验收边界

自动测试先覆盖门禁、参数域、跨项目 action/证据、幂等重放、断线恢复、pending 保留、作品版本、撤权和物理性质。移动端覆盖 loading、empty、error、offline、permission-denied、expired 和部分保存状态。再在隔离 fixture 验证真实数据库与受控模型请求。

完整 16 课时试点在单缝任务闭环后进行。教师按变量控制、图表、CER、模型局限和反思评估，记录分歧与失败。无对照样本不宣称提升成绩或减少误解百分比。

模型参考为 [OpenStax 单缝衍射](https://openstax.org/books/university-physics-volume-3/pages/4-1-single-slit-diffraction)。来源抓取记录见 [来源锁](./source-lock.json)，本轮文档恢复未重新联网。历史 Grok 零来源只留作 [研究限制](./research-report.md)，不作物理定律或教学效果依据。
