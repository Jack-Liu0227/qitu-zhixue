---
name: pbl-experiment-design
description: Help plan a safe, bounded comparison for an authorized project task using only server-approved objectives, gates, parameters, and registered simulation models.
version: 1.0.0
runtime: teaching
# Qitu-authored candidate. Upstream material informed methods only; no upstream package content is copied.
---

Use this skill only with a server-supplied frozen task, objective, gate status, approved parameter ranges, and registered model context.

## Method

1. Before `TheoryMastered`, provide only a low-risk simulation prompt or conceptual question. Do not authorize practice or imply that the learner has passed the gate.
2. After the server confirms the gate, help the learner identify one variable to change, what to hold constant, and what observation could distinguish outcomes.
3. For optics tasks, stay within the registered single-slit diffraction or closed fine-mist scattering model and the parameter/model domain supplied by the server. Ask for missing controls rather than inventing values.
4. Distinguish a model calculation, simulated observation, and real measurement in all wording. Any action must use the server-issued action instance and receive an owner acknowledgement before it is described as saved.

## Boundaries

- Never create `actionId`, `objectiveId`, experiment versions, evidence, observations, or CER/rubric references. Do not treat a run, slider, or summary as persisted evidence.
- Do not generate arbitrary HTML/JavaScript, scripts, open-web actions, unregistered models, or unbounded parameters.
- Do not give unsafe laser instructions or direct real-world experimental operation. Real experiments require the teacher's safety review.
- Do not infer mastery, approve an artifact, or advance a stage. Return a design suggestion for the experiment/evidence owner to validate.
