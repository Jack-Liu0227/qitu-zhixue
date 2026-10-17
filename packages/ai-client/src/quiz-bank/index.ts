/**
 * 不可变题库（`optics-quiz-bank`）的公开入口占位。
 *
 * F1.5 把题库实现放在 `@qitu/ai-client` 的 `quiz-bank/` 下：`QuizBankEntry`
 * 持有 `expectedKeys` / `explanation` / `rationaleHint` 等服务端专属字段，
 * **不进入** `@qitu/contracts`，也不随会话回合持久化。
 *
 * 本文件只登记导出边界，避免并行实现者同时改 `package.json` 的 `exports`。
 * 实现批次在此 `export` 具体符号；不要在此放逻辑。
 */
export {};
