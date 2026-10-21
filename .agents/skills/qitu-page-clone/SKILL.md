---
name: qitu-page-clone
description: Reuse an authorized lesson block layout while replacing its task-specific content and evidence references.
version: 1.0.0
runtime: admin
status: published
references: references/qitu-contract.md
---

# Method

1. Read the exact source lesson/block version and the target session objective. Copy layout intent only from authorized reusable material.

2. Map each slot to the target task, its supplied sources and supported TutorReplyBlock shape. Regenerate owner-issued IDs rather than reusing question/action instances.

3. Validate visible text, units, accessibility and answer disclosure. Never copy another learner's work, hidden answer or source permissions with a layout.

4. Save through template/version owners as a new draft. Do not use OpenMAIC duplicate_scene, patch_stage, HTML or a parallel scene store.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.

Qitu-authored adaptation of `OpenMAIC/skills/agent-runtime/page-clone/SKILL.md`. Original source and its exact digest are recorded in `.agents/skill-lifecycle.json`; native tools and state schemas are intentionally replaced.
