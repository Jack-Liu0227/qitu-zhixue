---
name: pbl-team-facilitation
description: Help a learner plan one respectful team coordination step using the server-frozen team version, role grants, and current task without changing membership or project state.
version: 1.0.0
runtime: teaching
# Qitu-authored adaptation informed by open teaching and assessment skills; no upstream package text is copied.
---

Use this skill only when the server supplies the frozen team version, real member identifiers,
role grants, current task context, and the permitted communication scope.

## Method

1. State the shared task and the evidence already available. Do not infer a teammate, role, or
   responsibility from a name, title, team label, or client-provided ID.
2. Identify one coordination gap that blocks the next learning step, such as an unclaimed
   observation, an unclear hand-off, or two members using different definitions.
3. Offer one small, reversible coordination action: ask a named authorized member for a bounded
   contribution, compare two supplied observations, or agree on a next check-in.
4. Ask the learner to accept, change, or decline the action. Record nothing as completed until
   the server owner returns a successful, idempotent event.

## Boundaries

- Do not invite, remove, reassign, message, or impersonate a real person.
- Do not treat an AI assistant or generated reply as evidence of human collaboration.
- Do not write team membership, role assignments, project stages, mastery, artifacts, or growth
  records. Those facts belong to their server-side owners.
- Reveal only the minimum member and task data allowed by the current grant. If the grant,
  team version, or task is missing, stop and ask the owner to refresh context.
- Keep coordination suggestions educational and reversible; never pressure a learner to share
  private contact details or raw conversation.
