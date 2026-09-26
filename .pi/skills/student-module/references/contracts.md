# Artifact contracts — student-module

下游步骤会解析这些文件。**逐字遵守**。真正未知时写 `null`，**绝不**写看起来
合理的猜测。所有产物位于运行目录 `.pi/runs/YYYY-MM-DD-<slug>/`。

---

## `brief.json` — Phase 0，父会话写

```json
{
  "module": "inspiration",
  "slug": "inspiration-free-explore",
  "created_at": "YYYY-MM-DD",
  "product_doc_section": "4.3 灵感空间",
  "in_scope": ["推荐项目卡片", "自由 Live 探索入口", "意图确认对话框"],
  "out_of_scope": ["语音 Live 实现", "推荐算法"],
  "frozen_nav_item": "灵感空间",
  "routes": ["/student/inspiration", "/student/inspiration/recommendations/:id"],
  "hard_rules": [
    "学生未确认意图不得创建正式项目",
    "推荐区与自由 Live 区视觉分离"
  ],
  "acceptance_focus": ["Live 中断后可恢复", "确认后只创建一个项目实例"],
  "notes": null
}
```

`module` 取值：`today` / `inspiration` / `tutor-ui` / `projects` / `works`。
`product_doc_section` 必填——子代理据此定位文档。

---

## `spec.md` — Phase 1，`student-planner` 写

必须包含小节：Goal、Routes and Navigation、Component Tree、Data Contracts、
States、Server-Owned Invariants、Acceptance Criteria（编号）、Risks and Open Questions。

**Data Contracts 的每条必须带标记：**

| 标记 | 含义 |
|---|---|
| `existing` | 已存在，必须给 `path:line` 证据 |
| `gap` | 产品文档定义了但代码没有；交 `contract-owner` |

**Acceptance Criteria 必须可验证**：能被命令检查，或能对照一个具名状态观察。
不可验证的条目要改写成 open question，不能留在验收清单里。

---

## `integration-report.md` — Phase 4，`student-integrator` 写

- 写出的文件（路由与 shell）
- 发现的**每个接口不匹配**及在接线层的适配方式
- 实际采用的 `assumed` 值（来自各 feature builder）
- 被迫 stub 的东西
- 有意**尚未接线**的部分

---

## `qa-report.md` — Phase 6，`student-qa` 写

```markdown
# QA — <module>
- Run: <run dir>
- Base: <git ref/sha>

## Commands
| command | result | notes |

## Acceptance checks
| # | criterion | verdict | evidence |

## UI states
| state | implemented | file |

## Invariants
| invariant | verdict | evidence |

## UNVERIFIED

## Verdict
VERDICT: PASS
```

`verdict` 只能是 `PASS` / `FAIL` / `UNVERIFIED`。每个 `FAIL` 必须归因到角色：
`student-feature` / `student-integrator` / `contract-owner` / `tutor-*`。

---

## `review.md` — Phase 6，`student-reviewer` 写

```markdown
## Verdict: SHIP / FIX-MAJOR / FIX-P0
Independence: cross-family | context-isolated same-family

## Findings
- `[P0-P3]` issue — impact, confidence, `path:line`, smallest fix.

## Test Gaps
```

未脱敏的未成年人原始对话、语音，或任何密钥出现在产物里都算 P0。

---

## 通用规则

- 未知值写 `null`，不要猜。
- 产物里出现的每个代码事实都要有 `path:line`。
- 不要把密钥、token、真实未成年人数据写进任何产物。
- 修复轮**追加**到 `review.md` / `qa-report.md`，不要覆盖首轮。
