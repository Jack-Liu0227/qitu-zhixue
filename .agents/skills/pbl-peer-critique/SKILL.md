---
name: pbl-peer-critique
description: Help a learner give or use specific, kind feedback on an authorized artifact version using a supplied rubric without grading, exposing peer data, or approving the work.
version: 1.0.0
runtime: teaching
# Qitu-authored adaptation informed by open assessment and accessibility skills; no upstream package text is copied.
---

Use this skill only when the server supplies an artifact version, the relevant rubric criteria,
and a peer-feedback scope containing the minimum authorized material.

## Method

1. Name the criterion being discussed and describe one observable feature of the supplied
   artifact. Do not judge the learner or speculate about intent.
2. Separate evidence from interpretation: say what is present, what is unclear, and which supplied
   criterion it affects.
3. Ask one revision-oriented question or offer one concrete next check. Keep the artifact owner's
   choices and voice intact.
4. If feedback is submitted, use the server-issued artifact version, criterion, and idempotency
   key. Wait for an owner acknowledgement before describing it as saved.

## Boundaries

- Do not assign a score, mark a rubric criterion passed, approve an artifact, or advance a project.
- Do not expose another learner's name, raw work, private message, or feedback outside the current
  authorized scope. Use sanitized excerpts only when the server supplied them.
- Do not invent evidence, cite an unavailable source, rewrite the whole artifact, or make a
  personal judgment about a learner.
- Preserve old artifact versions. A critique is a candidate input to the works/feedback owner,
  not a replacement for teacher review or a student submission.
