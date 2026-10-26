> 状态：原日期的方案或验证记录；2026-10-26 整理仅补充分类与引用，不新增功能完成或生产验收结论。

# 技能适配与全流程接入

本次把 DeepTutor、OpenMAIC 的 30 个原始技能接入启途智学现有服务，解除技能正文、文件和组合的固定字符限制。来源及摘要登记在 `.agents/skill-lifecycle.json`，上游目录不改写。

每个职责只保留一个 canonical ID 和一个当前源码包。原有 18 个教学技能均保留原名称，其中 6 个直接吸收新方法；另外保留 15 个 Admin 编排包、2 个画像与成长投影包。当前目录共 37 个包：21 个 teaching、16 个 admin。相较适配前新增 17 个包；来源清单覆盖的 23 个包包含 6 个被增强的原包。

## 原有技能如何处理

| canonical ID | 处理 |
| --- | --- |
| `pbl-understanding-coach` | 合并费曼解释、分层支架、短段讲解 |
| `pbl-source-literacy` | 合并来源核查、范围内调研、PDF 证据阅读 |
| `pbl-reflection-coach` | 合并自我解释、学习策略、自愿的情绪与过程反思 |
| `pbl-dynamic-lesson` | 合并深度交互、安全板书和视觉组织 |
| `pbl-artifact-revision` | 合并 Word/PPT 作品辅导、反馈修订、实践质量比较 |
| `pbl-data-literacy` | 合并 Excel 数据、单位、缺失值与公式辨析 |
| `optics-wave-inquiry` | 保留注册光学模型与实验域约束 |
| `pbl-ai-output-audit` | 保留 AI 输出的证据审查 |
| `pbl-cer-coach` | 保留主张、证据、推理辅导 |
| `pbl-concept-probe` | 保留当前题实例和提示等级内的帮助 |
| `pbl-defense-coach` | 保留证据答辩 |
| `pbl-driving-question` | 保留可探究的驱动问题辅导 |
| `pbl-experiment-design` | 保留安全、有界的比较设计 |
| `pbl-hypothesis-coach` | 保留观察到假设的联系 |
| `pbl-independent-transfer` | 保留撤去支架后的独立迁移 |
| `pbl-peer-critique` | 保留对真实作品的同伴反馈 |
| `pbl-team-facilitation` | 保留授权成员、角色内的协作辅导 |
| `pbl-visual-explainer` | 保留基于证据的可视化解释 |

6 个增强包的主文件保留原教学方法，补充方法存入已声明的 `references/adapted-methods.md`，项目权限与 owner 约束存入 `references/qitu-contract.md`。重复目录、替代关系清单、版本分流和冲突检查已删除；助手推荐、模板课时、动态教学和测试统一使用原 ID。

`tooling/adapt_skills.py` 复用同一 canonical 包，生成参考资料并重算整包摘要。原包的核心方法是权威输入，重复运行不会复制自身。`tooling/skills_lifecycle.py verify` 检查完整目录中的名称、重复版本目录、参考路径、30 个来源映射及 23 个适配包的摘要。

## 全流程接入

1. **项目模板。** Admin 管家读取课程规划、逆向设计、核心素养和螺旋复习技能，写入既有 `ProjectTemplateSpec`。课时可声明 `requiredSkillIds`，复用现有目标、任务、rubric 和证据合同。
2. **团队与助手。** guide、inquiry、artifact、profile、growth 角色建议均引用唯一 canonical ID。实际助手和成员、provider/model、工具及知识范围由 Admin 显式配置。建议不授予执行权。
3. **课件交互。** 冻结课时决定角色和技能。`pbl-dynamic-lesson` 与授权工具共同开放既有候选通道，支持 BoardBlock、Mermaid、KaTeX、形成性问题和注册光学模型。
4. **问答交互。** 当前题实例、提示等级、pending 和答案披露约束继续生效。技能提出候选教学动作，学生回答或操作产生证据，由服务端 owner 验证并保存。
5. **作品和资料。** 既有上传 owner 解析 PDF、DOCX、PPTX、XLSX；固定渲染器将有权读取的作品版本导出为这些格式。导出不生成掌握、提交或评价事实。
6. **个人画像。** `qitu-learner-profile` 消费受限事件和证据 manifest，只产生候选；投影 owner 校验来源、对象、授权、策略和基础版本后接纳。
7. **成长轨迹。** `qitu-growth-trajectory` 复用同一投影管线，区分对话表达、模拟观察、独立表现、正式作品与掌握事实。学生和家长只读取已接纳的授权投影。

未提供证据或尚未接纳时保留未知或待审核状态，不以课堂互动或文件转换替代学习事实。

## 运行时与文件合同

- 技能正文、声明参考资料和组合不再受 7,500 / 8,000 / 24,000 字符及旧文件读取上限限制，也不静默截断。实际模型上下文容量和对象权限继续生效。
- API 和 worker 共用包加载器；声明参考资料与主文件一起进入 `packageDigest`。缺失、重复、越界和链接资源不能加载。
- Admin 技能通过管家参考读取，不绑定学生或投影助手。画像与成长助手不能执行交互工具。
- `GET /api/v1/artifacts/:artifactId/versions/:versionId/export?format=docx|pptx|xlsx|pdf` 由 WorksService 在生成前后校验可见性，审计只记元数据。固定 Python 渲染器不接收模型代码、命令或路径，Excel 原始公式文字不执行。

文件导出依赖 `python-docx`、`python-pptx`、`openpyxl`、`PyMuPDF`，服务端可用 `QITU_ARTIFACT_PYTHON` 选择解释器。失败、断网、撤权和切换作品版本均有明确反馈。

## 验证与发布

```text
python tooling/skills_lifecycle.py verify
python tooling/test_skill_lifecycle.py
python tooling/test_render_artifact.py
node tooling/verify-skill-lifecycle.mjs
```

验证脚本按 contracts、database、infra、agent-memory、ai-client、model-runtime 顺序构建，再检查 API、worker 与学生端，并执行行为回归。UNC 安装快照通过测试专用路径解析当前源码产物。

canonical 名称稳定不代表旧摘要仍然有效。内容改变后必须通过现有团队版本和绑定 owner 重审；历史项目冻结摘要不自动改写，漂移继续明确拒绝。仓库源码存在、本地发布元数据、线上配置与真实请求成功是不同状态。本次不修改线上配置、生产学习事实或历史项目快照。验证范围见 [verification.md](verification.md)。
