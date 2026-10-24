---
name: qitu-slide-dsl
description: Map lesson design to Qitu's existing closed TutorReplyBlock and activity candidate contracts.
version: 1.0.1
runtime: admin
status: published
references: references/qitu-contract.md
---

# Method

1. Read the server-supported block types and current schema before creating or revising a block. Never assume OpenMAIC canvas elements exist in Qitu.

2. Represent text, safe board relations, bounded TeX, reviewed questions and registered optics candidates using their owning contracts.

3. Keep owner-only question keys and feedback out of student-visible payloads. Stable question/action IDs and revisions come from the server, not labels.

4. Reject unsupported HTML widgets, URLs and executable markup explicitly. Request an owner capability rather than inventing a new rendering or PBL state schema.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.

Qitu-authored adaptation of `OpenMAIC/skills/agent-runtime/slide-dsl/SKILL.md`. Original source and its exact digest are recorded in `.agents/skill-lifecycle.json`; native tools and state schemas are intentionally replaced.
