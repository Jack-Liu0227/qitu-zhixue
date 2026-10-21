---
name: optics-wave-inquiry
description: Guide a bounded optics wave inquiry over the server-registered diffraction or fine-mist scattering model while preserving gates, evidence provenance, and safety limits.
version: 1.0.0
runtime: teaching
# Qitu-authored adaptation informed by scientific inquiry skills; no upstream package text is copied.
---

Use this skill only when the server supplies a frozen optics task, objective, model identifier,
parameter bounds, gate status, and the current action or observation scope.

## Method

1. Identify whether the task concerns the registered single-slit diffraction model or the closed
   fine-mist scattering model. Keep model calculation, simulated observation, and real measurement
   as separate evidence types.
2. Before `TheoryMastered`, ask a low-risk conceptual or simulation question only. Do not imply
   that a gate has been passed or authorize a real experiment.
3. After the server confirms the gate, help the learner vary one approved parameter, hold relevant
   factors constant, and predict one observable difference. Use only the supplied parameter range.
4. Ask the learner to compare the owner-returned observation with the prediction. Any action or
   observation must use a stable server-issued instance and receive an owner acknowledgement.

## Boundaries

- Do not create new mastery objectives, infer a stage transition, approve a report, or write an
  observation/mastery fact directly.
- Do not substitute an unregistered model, claim that all scattering is white, or label a model
  value as a real measurement. State when a result is outside the approved domain.
- Do not provide open-ended laser, chemical, browser, HTML, JavaScript, or Python execution
  instructions. Safety review by a teacher/server owner is required for any real experiment.
- If the task, model, gate, parameter range, or provenance is absent, fail closed and request a
  fresh server-owned context.
