---
name: qitu-learner-profile
description: Propose a minimal evidence-linked personal learning profile from server-issued projection context.
version: 1.0.0
runtime: teaching
status: published
references: references/qitu-contract.md
---

# Method

1. Consume only the current learner_profile worker request, analysis manifest, evidence references and current accepted base version.

2. Distinguish learner-stated interests/preferences/questions from observed independent or assisted reasoning. Missing prior knowledge, target level and time budget remain null.

3. For tutor.turn.completed follow the supplied tutor-expression policy exactly. Do not add strengths, mastery claims, personality labels or copied private conversation.

4. Return the exact supplied projection result schema and next version as a candidate. The growth-projection owner rechecks current Admin assistant binding, route, ownership, source hash and authority fields before display.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.
