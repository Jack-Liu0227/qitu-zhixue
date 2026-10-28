# VISUAL-20261019: Four-Surface Density And Companion Refresh

## Scope And Status

- Request: visually review student, parent, teacher and Admin at `http://122.51.130.204`, reduce unnecessary whitespace, fix squeezed/obscured controls, and replace legacy robot marks.
- Implementation: frontend presentation only. Frozen navigation, teaching gates, permissions, provider routing and persisted avatar IDs stay unchanged.
- Release status: deployed as part of the user-authorized, reviewed integration release `8413ef811e19cf0e1c029fc05150325b39076111` on `study-remote` at 2026-10-19 06:22:27 Asia/Shanghai.
- This is not a blind deployment of the dirty worktree or a UI-only release. The coordinated release also contains separately reviewed documentation, model configuration, runtime, tutor-renderer and API fixes; see the [takeover release record](../codex/takeover-validation-20261019.md).

## Findings And Fixes

| Surface | Finding | Change |
| --- | --- | --- |
| Student shell | Repeated greeting panels displaced actual work on every destination. | Keep the greeting on Today only; compact account chrome without removing account/navigation controls. |
| AI companion | The page assumed a header height instead of using its real available viewport; side cards shrank or obscured the composer. | Bounded flex layout, scrollable content, non-shrinking cards and responsive side panels. On mobile, opening history and context is mutually exclusive; short screens reclaim the collapsed history rail while context is open. |
| Conversation | Author names, role chips, copy, speech and playback speed squeezed into vertical text. | Wrap the author/action row; preserve complete non-shrinking button labels. Shorten redundant input placeholder instructions while keeping attachment/paste support. |
| Project detail | Ten full-width stage rows created a very tall sparse page. | Responsive stage-card grid in the same server-provided order; put breadcrumb and growth link on one wrapping toolbar. No stage/gate logic changes. |
| Parent | Duplicate headings and large welcome panels; floating contact widget obscured content. | One heading, compact child selector, two-column mobile metrics, topbar contact entry, hidden feedback panel when closed. Keep the same feedback submission flow. |
| Parent project | Narrow facts and an unstyled conversation suggestion button. | Responsive facts, readable label spacing and shared button styling for copying suggested questions. |
| Teacher | Stretched short cards and an unbounded activity feed produced long empty areas beside the list. | Align cards to their content; bound the desktop detail region with keyboard scrolling; wrap long activity metadata. |
| Admin | Oversized overview hero and sparse metric layout; settings sidebars and toolbars squeezed mobile headings/forms. | Remove the decorative overview hero, compact metrics, wrap controls and show the unchanged mobile settings navigation as a labelled horizontal rail. |
| Admin editors | Duplicate form spacing, a required marker on a separate line, tall blank prompt editors and wrapping status chips. | Compact editor spacing, inline label markers, responsive prompt areas and non-shrinking publication status. |
| Shared artwork | Multiple unrelated robot SVG/emoji/image presentations. | One locally bundled transparent companion through `RobotMascot` / `AssistantGlyph`, including public-site robot artwork. Preserve Admin-selected non-robot custom avatars. |

The companion asset is `packages/ui/assets/assistant/qitu-companion.png` (256 x 256 RGBA, 98,925 bytes). Generation prompt and provenance are documented beside the asset. No external image host is needed; Next static imports retain each application's basePath.

## Browser Coverage

Primary/alias entries and representative reachable detail states were checked at 1440 x 960, 768 x 844 and 390 x 844. Screenshots, geometry and reports remain in a local temporary directory, not the repository.

| Role | Fixed entries | Additional representative states |
| --- | --- | --- |
| Student | Root, Today, inspiration, tutor, projects, works, growth, profile | Project overview, recommended template, practice mode, learning mode, overview mode; the tutor root also reaches the current project's tutor route. |
| Parent | Home, progress, messages | Contact dialog opening, viewport bounds and Escape dismissal. |
| Teacher | Root, dashboard, students, issues, statistics, knowledge | Student detail compatibility redirect; desktop detail scrolling by keyboard. |
| Admin | Overview, students, student statistics, teachers, relationships, copilot, models; settings overview, account, providers, assistants, skills, teams, templates, knowledge, tools, runtime, profile growth, appearance, dialogs, plugins, Feishu, database, ops, system, about, legacy models | Teacher detail; assistant editor, team detail/member editor, template workflow/basic editor. Internal settings scroll areas were also captured at their bottom. |

Validation results:

- Route sweep: 51 fixed/representative entries, 153 viewport checks.
- Interaction/state checks: 28, including short-phone 375 x 667 Tutor controls and browser-injected loading, empty, 403, service-error and disconnected states across four roles.
- Admin editor checks: 10 desktop/mobile checks; no save, publish, activation or deletion actions.
- Artwork/SSR tests: 5 in `tooling/visual-layout.test.mjs`.
- Shared brand tests: 4; reduced-motion checks: 11; basePath and teacher-link guards pass.
- Lint baseline and TypeScript checks: shared UI plus all five frontend applications pass.
- Next production builds: student, parent, teacher, Admin and auth portal pass in the isolated local build copy.

The scope is not every record in the database. Admin's intentionally unavailable individual-student entry was not enabled or bypassed. No teacher intervention detail existed in the available account; its empty list was checked. The unlinked legacy workbench was not made into a new navigation destination or claimed as runtime-verified. Browser layout checks are not a replacement for server authorization or teaching-state tests.

## Verification Method And Reproduction

`tooling/verify-visual-layout.cjs` is the reusable route sweep. It requires an explicitly selected test login origin and a local temporary output directory. It uses visible Chromium (or an existing dedicated CDP connection), copies authentication cookies only in memory, forwards read-only API requests to the selected origin and blocks all writes after login. It does not save cookies, credentials or API response bodies. Test-account sign-in is the only authentication write used.

```powershell
$env:QITU_PLAYWRIGHT_MODULE = '<path-to-playwright-module>'
$env:QITU_VISUAL_LOGIN_ORIGIN = 'http://122.51.130.204'
$env:QITU_VISUAL_OUTPUT = Join-Path $env:TEMP 'qitu-visual-audit'
# Defaults: local student/parent/teacher/Admin ports 3201/3202/3203/3204.
# Override QITU_VISUAL_ORIGINS with a role-to-origin JSON object when needed.
node tooling/verify-visual-layout.cjs
node --test tooling/visual-layout.test.mjs tooling/brand-story.test.mjs
node tooling/check-basepath.mjs
node tooling/validate-teacher-links.mjs
node tooling/validate-reduced-motion.mjs
```

The UNC installation's `node_modules/@qitu/*` entries are installation snapshots, not links to the current workspace source. Direct UNC development also encountered Next/Watchpack resolution problems. Verification therefore used a disposable local source copy with workspace package links; contracts, database and ai-client were built in dependency order before app checks. Dependencies were provisioned only in the temporary workspace. No repository dependency/lockfile change belongs to this visual task. Production builds used a second disposable copy so they could not overwrite running dev servers' `.next` output.

## Safety And Release Notes

- No backend/database/auth policy change; no data migration.
- No project, mastery, evidence, feedback, provider or runtime configuration writes during the visual checks. The final browser reports record zero attempted writes.
- Parent request identity/latest-request guards remain intact. Displayed projections are not promoted to learning/completion facts.
- Existing unrelated modifications were retained, including concurrent changes within the tutor renderer and Admin model-selection area. They are not part of this visual change's claimed implementation.
- The browser coverage counts above remain the original isolated/local verification, not a repeated authenticated production sweep. The later release verifies 12 public routes and their CSS/JS, all five companion images against the source SHA256, anonymous redirects, and public home/login at 375/768/1440px; no production login or teaching writes were performed in that release smoke test.
