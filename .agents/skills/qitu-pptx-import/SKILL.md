---
name: qitu-pptx-import
description: Turn owner-parsed PowerPoint material into a governed Qitu session draft with explicit provenance.
version: 1.0.0
runtime: admin
status: published
references: references/qitu-contract.md
---

# Method

1. Accept only uploaded material IDs and the document owner's extracted slide/notes content. A filename is not a successful import.

2. Preserve the source sequence, figures and speaker-note distinctions when the user requests faithful import. Record omissions and unsupported media explicitly.

3. Map each useful slide to a supported board, source excerpt or task in the selected template version. Add questions only where authorized and ground them in real references.

4. Validate source scope and new block identities before template save. Imported layout and completed narration do not prove learner understanding or authorize arbitrary HTML.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.

Qitu-authored adaptation of `OpenMAIC/skills/agent-runtime/pptx-import/SKILL.md`. Original source and its exact digest are recorded in `.agents/skill-lifecycle.json`; native tools and state schemas are intentionally replaced.
