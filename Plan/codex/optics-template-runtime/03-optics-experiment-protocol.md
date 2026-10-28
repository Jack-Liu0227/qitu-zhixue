> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# 03 · Optics Experiment Protocol

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

## 当前缺口

`optics_experiment` 已经是可视化卡片，但它不能把滑块摘要直接当成实验事实。正式协议需要 action 实例、参数校验、幂等事件、持久化 observations 和 CER/rubric 引用。

## 服务端合同

```ts
type OpticsAction =
  | 'submit_prediction'
  | 'set_parameter'
  | 'run'
  | 'record_observation'
  | 'submit_evidence';

interface OpticsActionRequest {
  projectId: string;
  sessionId: string;
  experimentId: string;
  specVersion: string;
  objectiveId: string;
  actionId: string; // 服务端签发，不能由 label/cache id 替代
  action: OpticsAction;
  parameters: Record<string, number | string>;
  idempotencyKey: string;
}
```

服务端必须校验 frozen project snapshot、课时、objective、Rayleigh/单缝模型域、参数上下限和 prediction gate；返回 owner receipt 后前端才显示“已保存”。

## 模型与安全

- 仅注册单缝衍射和封闭细雾室散射模型。
- 区分 `model_calculation`、`simulated_observation`、`real_measurement`；公式结果不能标为实测。
- Rayleigh 关系只在批准域使用；不能把所有非 Rayleigh 结果写成白色 Mie 散射。
- 真实实验必须经过教师安全审核；护目镜提示不能替代安全方案。

## 交互

滑块可以即时重绘本地模拟结果；保存动作走服务端协议。画布、公式、图表都提供“全屏查看”按钮（只改变 UI viewport，不改变实验权限或数据）。
