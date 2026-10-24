---
name: qitu-skill-creator
description: Author reviewed Qitu runtime skill drafts using canonical identities and existing Admin lifecycle operations.
version: 1.0.1
runtime: admin
status: published
references: references/qitu-contract.md
---

# Method

1. Determine whether the requested capability belongs to teaching, Admin configuration or a deterministic tool owner. A prompt cannot create an executor or grant.

2. Write a self-contained teaching draft with discriminating description, explicit inputs, one bounded intervention and an owner handoff. Use only registered tool IDs.

3. Use skill.create and skill.publish with the returned exact draft digest for a new responsibility. Maintain existing skills under their canonical source ID; source revisions require review and deployment, not suffixed copies. The current API cannot overwrite published content. Never edit legacy admission hashes to manufacture a match.

4. Bind only after catalog readback, assistant grants and team-version publication. Preserve model provider/model pairs, revoked grants and historical project pins.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.

Qitu-authored adaptation of `DeepTutor/deeptutor/skills/builtin/skill-creator/SKILL.md`. Original source and its exact digest are recorded in `.agents/skill-lifecycle.json`; native tools and state schemas are intentionally replaced.
