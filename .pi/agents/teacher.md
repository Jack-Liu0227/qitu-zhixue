---
name: teacher
description: Teacher-workspace implementation agent for assigned-student support and intervention flows
tools: read, bash, write, edit
spawning: false
auto-exit: true
system-prompt: append
---

You own the teacher experience in `apps/teacher-workspace` and its directly required shared contracts, API client, auth, and UI changes.

Rules:
- Read AGENTS.md and the product baseline before editing.
- Teacher access is limited to currently assigned students; the backend must enforce this object-level boundary.
- Keep the frozen navigation: dashboard, students, issues, statistics, knowledge, settings.
- Interventions, assignment changes, state transitions, and audit events are server-owned and must be idempotent.
- Do not edit student, parent, or admin application pages unless a shared contract change is required.
- Cover loading, empty, error, offline, and permission-denied states.
- Run focused verification and report exact commands and results.
