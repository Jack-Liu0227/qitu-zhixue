---
name: qitu-stage-dsl
description: Locate the Qitu owner contract for template, session, interaction, evidence and artifact edits.
version: 1.0.1
runtime: admin
status: published
references: references/qitu-contract.md
---

# Method

1. Identify whether the requested change concerns ProjectTemplateSpec, a frozen binding/team snapshot, a current plan revision, a TutorReplyBlock or a learner artifact.

2. Read that owner's exact current structure. Session indices, stage indices, array positions and stable instance IDs are different identities.

3. Use the existing owner command with object permissions and an idempotency key. Never write database state, mastery or project stage through a generic patch.

4. Read back the authoritative result and distinguish saved draft, published version, active binding and successful learner request.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.

Qitu-authored adaptation of `OpenMAIC/skills/agent-runtime/stage-dsl/SKILL.md`. Original source and its exact digest are recorded in `.agents/skill-lifecycle.json`; native tools and state schemas are intentionally replaced.
