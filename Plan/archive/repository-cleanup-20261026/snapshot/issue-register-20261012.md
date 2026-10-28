# Qitu Zhixue Issue Register

Audit baseline: `origin/main` at `b1612f6` on 2026-10-12. An item is closed only when its stated scope has code or verification evidence. UI-only work does not prove the backend data loop.

## Completed And Closed

| Issue | Scope | Evidence |
| --- | --- | --- |
| [#41](https://github.com/Jack-Liu0227/qitu-zhixue/issues/41) | Public home and unified login code | `0952b4a`, `2751160`, `57bacd3` |
| [#46](https://github.com/Jack-Liu0227/qitu-zhixue/issues/46) | Admin AI resource CRUD and team/template management | `7aac299`, `2f36605`, `49758c8`, `1ce2a5b`, `b05f5de` |
| [#47](https://github.com/Jack-Liu0227/qitu-zhixue/issues/47) | Model sync, MCP JSON workbench and capability matrix | `cce6974`, `334c4d4`, `0afaa51` |
| [#48](https://github.com/Jack-Liu0227/qitu-zhixue/issues/48) | AI conversation layout, Markdown/math and responsive interaction | `193ac97`, `568f579`, `89a4a82`, `0afaa51`, `b1612f6` |

## Current Open Work (Nine New Issues)

| Issue | Scope |
| --- | --- |
| [#49](https://github.com/Jack-Liu0227/qitu-zhixue/issues/49) | Knowledge base upload, classification, team/assistant authorization and real retrieval |
| [#50](https://github.com/Jack-Liu0227/qitu-zhixue/issues/50) | Plugin framework: MCP/built-in tool manifest, lifecycle, authorization and audit |
| [#51](https://github.com/Jack-Liu0227/qitu-zhixue/issues/51) | Qitu Copilot server sessions and real SDK execution |
| [#52](https://github.com/Jack-Liu0227/qitu-zhixue/issues/52) | study-remote production E2E, direct access and four-platform data consistency |
| [#53](https://github.com/Jack-Liu0227/qitu-zhixue/issues/53) | Agent SDK runtime resolver, team orchestration and tool/MCP execution |
| [#54](https://github.com/Jack-Liu0227/qitu-zhixue/issues/54) | PBL templates, recommendations, intent confirmation, team binding and stage gates |
| [#55](https://github.com/Jack-Liu0227/qitu-zhixue/issues/55) | Student-isolated sessions, memory, profile and growth data foundation |
| [#56](https://github.com/Jack-Liu0227/qitu-zhixue/issues/56) | Unified four-platform theme, density, login entry and mobile acceptance |
| [#57](https://github.com/Jack-Liu0227/qitu-zhixue/issues/57) | Admin AI configuration center: models, assistants, teams, Skills, tools and MCP governance |

## Closed Legacy Backlog

The existing legacy backlog issues #2-#11, #14-#30, #34 and #45 were closed per the product owner's request. Their remaining implementation scope was moved into #49-#56; closing the legacy records does not remove those acceptance criteria. Existing #39 and #41 are also closed.

## Operating Rules

- Cross-platform data, permissions and minor-data isolation stay open until server-side evidence exists.
- `study-remote` and Clash direct-access settings are deployment/environment records; no personal proxy configuration or credentials belong in git.
- The full pnpm check must run from a mapped/local filesystem path because Windows CMD cannot use the current UNC path as a working directory.
