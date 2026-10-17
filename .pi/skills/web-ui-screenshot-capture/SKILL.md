---
name: web-ui-screenshot-capture
# runtime 取值 dev-only —— 开发期工具，绝不得进入学生运行时。
# 即使本目录被误移回 .agents/skills/，API（runtime-source.ts）与 workers
# （team-runtime-executor.ts）两侧 loader 都会排除它。两道防线——目录位置 + 本标签。
runtime: dev-only
description: This skill should be used when a user asks to visit a web app, discover its frontend routes, log into role-specific workspaces, and save complete-page screenshots organized by interface area. It crawls same-origin links, supports demo-button or environment-based login, preserves query routes, retries slow pages, and writes a manifest with capture status.
---

# Web UI Screenshot Capture

Use this skill to create a reproducible screenshot inventory for a web application. Treat screenshots as a read-only browser task: navigate, authenticate only with credentials explicitly supplied by the user or the site’s own demo-account controls, and save captured pages under the requested output directory.

## Run the bundled capture script

Run `scripts/capture_ui.mjs` with Node. The script uses Playwright and automatically detects Chrome or Edge. Install Playwright separately when the runtime does not already provide it, or set `PLAYWRIGHT_NODE_MODULES` to the module directory.

```powershell
node scripts/capture_ui.mjs `
  --url http://127.0.0.1:3000 `
  --output AdminUI `
  --roles admin,parent,teacher,student
```

Use a route seed file when the application has pages that are not linked from the visible navigation. Each non-comment line contains `folder route [authRole]`:

```text
home / 
login /login
admin /admin admin
admin /admin/settings/models admin
student /student student
student /student/projects/project-demo-python/theory student
```

Pass it with `--routes-file routes.txt`. The script follows same-origin links from every seed, so linked detail pages and query variants are added automatically. Use `--max-pages` to cap the crawl and `--timeout` for slow backends.

## Authentication

For roles named `student`, `parent`, `teacher`, and `admin`, click the corresponding `.login-demo-buttons` control when it exists. When demo controls are unavailable, provide role-specific environment variables before running:

```powershell
$env:SCREENSHOT_ADMIN_EMAIL='admin@example.com'
$env:SCREENSHOT_ADMIN_PASSWORD='...'
```

Do not invent credentials, persist them in the skill, or place them in route files. Keep screenshots and manifests free of tokens and passwords.

## Organize and verify output

Store screenshots in the requested folder. Use one folder per interface area, such as `admin`, `parent`, `home`, `student`, `teacher`, and `login`. Preserve query variants in filenames so distinct UI modes do not overwrite each other. Review `manifest.json` after capture; investigate records with an error or a null HTTP status, and report pages that could not be reached instead of presenting them as successful captures.

For a project with a known route contract, derive a seed file from the frontend route tree and include dynamic IDs that are valid in the current demo data. Capture at desktop size by default, then repeat with a mobile viewport when responsive behavior is part of the request.
