# AI搭档与团队运行时集成方案

## 当前状态分析

### 已实现的集成点

1. **TutorService 与 TeamRuntimeService 集成**
   - 路径：`services/api/src/modules/ai-tutor/tutor.service.ts`
   - 已注入 `TeamRuntimeService` 可选依赖
   - 在 `submitStudentTurn` 时调用 `teamRuntime.startRun()` 创建团队运行
   - 支持通过 `teamRuntime.delegateIfAvailable()` 委派给团队成员

2. **TutorController 流式集成**
   - 路径：`services/api/src/modules/ai-tutor/tutor.controller.ts`
   - 在流式响应中通过 `teamRuntime.listSessionStreamFrames()` 获取团队事件帧
   - 支持实时推送团队状态变化到学生端

3. **学生端数据源实现**
   - 路径：`apps/student-center/features/tutor/data/tutorApiDataSource.ts`
   - 通过 `/api/v1/tutor/session` 获取会话历史
   - 通过 `/api/v1/tutor/sessions/:id/stream` 建立流式连接
   - 使用 `LiveTutorSocket` 处理实时事件流

### 核心集成流程

```
学生发送消息
  ↓
TutorService.submitStudentTurn()
  ↓
创建 TeamRun (如果配置了团队)
  ↓
调用 GatewayTutorProvider (真实模型)
  ↓
TeamRuntime.delegateIfAvailable() 委派给团队成员
  ↓
流式返回：
  - 助手回复 (文本流)
  - 团队事件帧 (phase_advanced, gate_blocked, tool_invoked, thinking)
  ↓
学生端接收并渲染
```

## 需要完成的工作

### 1. 确保模型配置正确绑定

**问题**：`GatewayTutorProvider` 需要从模型注册表获取 `tutor.chat` 角色绑定的真实模型。

**检查点**：
- [ ] 验证 `model-registry` 模块中是否配置了 `tutor.chat` 角色
- [ ] 确认模型绑定指向有效的模型提供商（如 OpenAI, Anthropic, 阿里云百炼等）
- [ ] 测试 `live` 模式下模型调用是否正常

**文件位置**：
```
services/api/src/modules/model-registry/
services/api/src/modules/ai-tutor/gateway-tutor.provider.ts
```

**验证脚本**：
```typescript
// 检查模型配置
const modelGateway = app.get(ModelGateway);
const tutorModel = await modelGateway.getConfiguredModel('tutor.chat');
console.log('Tutor模型配置:', tutorModel);
```

### 2. 团队配置与助手关联

**问题**：需要确保管理后台创建的团队配置正确关联到学生的AI搭档会话。

**检查点**：
- [ ] 验证 `AdminTeamConfig` 中的 `members` 配置是否正确保存
- [ ] 确认每个成员的 `assistantId` 指向有效的 `AdminAssistantConfig`
- [ ] 测试团队成员的 `model` 字段是否正确配置模型ID
- [ ] 验证 `leaderAssistantId` 是否作为默认对话入口

**数据流**：
```
1. Admin创建团队 → 保存到 agent_team_configs 表
2. 配置成员和角色 → 保存 members 数组
3. 学生发起会话 → TutorService 查询学生关联的团队
4. 创建 TeamRun → 使用团队配置初始化运行时
5. 委派给 leader → 调用对应助手的模型
```

### 3. PBL 阶段门禁集成

**问题**：AI搭档需要感知学生项目的 PBL 阶段，并根据阶段门禁调整教学策略。

**检查点**：
- [ ] 确认 `TutorProjectContext` 正确包含项目阶段信息
- [ ] 验证 `TeamRuntimeService` 的门禁检查是否生效
- [ ] 测试阶段推进事件是否正确传递到学生端
- [ ] 确认 `theory_mastered` 门禁拦截实践阶段访问

**关键事件**：
```typescript
// 阶段推进事件
{
  kind: 'phase_advanced',
  data: {
    fromPhase: 'theory_learning',
    toPhase: 'practice_ready',
    gateSatisfied: 'theory_mastered'
  }
}

// 门禁拦截事件
{
  kind: 'gate_blocked',
  data: {
    targetPhase: 'practice_ready',
    requiredGate: 'theory_mastered',
    reason: '需要完成理论达标测试'
  }
}
```

### 4. 流式事件正确传递

**问题**：学生端需要正确接收和处理团队运行时的各类事件帧。

**检查点**：
- [ ] 验证 `TutorController.streamTurn()` 正确注入团队事件
- [ ] 测试 `LiveTutorSocket` 是否正确解析团队帧
- [ ] 确认学生端 UI 能够展示团队状态变化
- [ ] 验证思考过程 (`thinking` 帧) 的可视化

**事件类型映射**：
```typescript
const TEAM_FRAME_NAMES = {
  phase_advanced: 'team.phase_advanced',      // 阶段推进
  gate_blocked: 'team.gate_blocked',          // 门禁拦截
  member_delegated: 'team.member_delegated',  // 成员委派
  tool_invoked: 'team.tool_invoked',          // 工具调用
  thinking: 'team.thinking',                  // 模型思考
}
```

### 5. 卡顿检测与升级机制

**问题**：AI搭档需要检测学生学习停滞，并在必要时升级提示等级或通知班主任。

**检查点**：
- [ ] 验证 `LearningStallSignalSink` 是否正确接线
- [ ] 测试卡顿计数累积逻辑
- [ ] 确认达到阈值后的升级行为
- [ ] 验证班主任通知是否正确发送

**升级逻辑**：
```typescript
// 在 TutorService 中
if (stallCount >= LEARNING_STALL_ESCALATION_THRESHOLD) {
  // 1. 记录升级事件
  await this.auditWriter?.writeEvent({
    action: 'tutor.escalate',
    detail: '学生学习停滞，升级至班主任'
  });
  
  // 2. 发送停滞信号
  await this.stallSink?.signal({
    source: LEARNING_PROGRESS_STALL_SOURCE,
    studentId: userId,
    projectId: projectId,
    stallCount: stallCount
  });
  
  // 3. 标记会话状态
  session.escalated = true;
}
```

## 部署检查清单

### 服务器端

- [ ] 确认 `QITU_DATA_MODE=live` 环境变量
- [ ] 验证数据库迁移完成（`tutor_sessions`, `agent_team_configs` 等表）
- [ ] 检查模型提供商 API 密钥配置
- [ ] 测试团队配置 API 端点 (`/api/v1/admin/teams`)
- [ ] 验证 AI搭档流式端点 (`/api/v1/tutor/sessions/:id/stream`)

### 客户端

- [ ] 重新构建 admin-console 应用（包含新的团队管理界面）
- [ ] 重新构建 student-center 应用
- [ ] 验证前端路由正确指向后端 API
- [ ] 测试 WebSocket 连接稳定性
- [ ] 检查团队状态可视化组件

### 端到端测试

1. **管理员操作**
   - [ ] 登录管理后台
   - [ ] 创建新团队
   - [ ] 配置团队成员和角色
   - [ ] 绑定模型到助手

2. **学生操作**
   - [ ] 登录学生端
   - [ ] 发起AI搭档对话
   - [ ] 验证收到真实模型响应（非演示模式）
   - [ ] 观察团队状态变化

3. **PBL 流程**
   - [ ] 创建项目并确认意图
   - [ ] 进入理论学习阶段
   - [ ] 尝试提前进入实践阶段（应被门禁拦截）
   - [ ] 完成理论达标测试
   - [ ] 成功进入实践阶段

## 服务器部署命令

```bash
# 1. SSH 连接到服务器
ssh user@122.51.130.204

# 2. 进入项目目录
cd /path/to/qitu-zhixue

# 3. 拉取最新代码
git pull origin main

# 4. 安装依赖
pnpm install

# 5. 构建所有应用
pnpm build

# 6. 运行数据库迁移
pnpm --filter @qitu/database migrate:deploy

# 7. 重启服务
pm2 restart qitu-api
pm2 restart qitu-admin-console
pm2 restart qitu-student-center

# 8. 查看日志
pm2 logs qitu-api --lines 100
```

## 下一步行动

1. **立即执行**：在远程服务器上部署新版代码并测试团队管理界面
2. **验证集成**：创建测试团队和助手，验证学生端能否正确调用真实模型
3. **监控日志**：观察 API 日志中的模型调用和团队运行时事件
4. **修复问题**：根据测试结果调整配置或修复代码

## 相关文档

- [团队管理界面改进计划](./ui-improvement-plan.md)
- [AI搭档架构文档](../README.md#ai-搭档架构)
- [PBL 阶段门禁规范](../sdk/pbl-gates.md)
