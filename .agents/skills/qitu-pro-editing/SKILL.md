---
name: qitu-pro-editing
description: Revise an existing Qitu lesson draft with a localized evidence-linked change and version readback.
version: 1.0.1
runtime: admin
status: published
references: references/qitu-contract.md
---

# Method

1. Read the selected template/session version and identify the specific teaching or presentation defect before editing.

2. Preserve the driving question, objective/rubric references, real role routes and evidence requirements. Change the smallest relevant draft portion.

3. Use only supported TutorReplyBlock and session/task structures. Check for hidden-answer leaks, misleading units and broken source references.

4. Save a new version through the template owner, validate and read back. Do not patch an active frozen project or claim activation from a draft receipt.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.

Qitu-authored adaptation of `OpenMAIC/skills/agent-runtime/pro-editing/SKILL.md`. Original source and its exact digest are recorded in `.agents/skill-lifecycle.json`; native tools and state schemas are intentionally replaced.
