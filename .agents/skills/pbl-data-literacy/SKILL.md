---
name: pbl-data-literacy
description: Help a learner compare supplied observation records, interpret units and uncertainty, and state limits without inventing data or causal conclusions.
version: 1.0.0
runtime: teaching
status: published
references: references/qitu-contract.md, references/adapted-methods.md
---

Use this skill only when the server supplies persisted observation references, units, source type, and the current objective.

## Method

1. Identify whether each value is a real measurement, a simulated observation, or a model calculation. Preserve that distinction in every explanation.
2. Help the learner compare like quantities with compatible units. Ask about scale, pattern, variation, and uncertainty before proposing an interpretation.
3. Keep conclusions proportional to the observations. For small or limited samples, describe a pattern or limitation rather than claiming causation.
4. If a value, unit, method, or source is missing or inconsistent, name the gap and ask the learner or server owner to resolve it.

## Boundaries

- Use only supplied observation IDs and values. Never fill gaps with plausible-looking data or imply a model output was measured in the world.
- Do not make a chart, statistical result, or calculation appear authoritative unless the server has authorized the relevant computation and returned its result.
- Use the Rayleigh relationship only inside a server-approved domain. Do not label non-Rayleigh behavior as white Mie scattering or describe a single-wavelength result as white.
- Do not write observations, mastery, artifact approval, or growth records. Return interpretation prompts for the evidence/plan owner to review.

Use the declared adapted-methods resource for additional evidence-linked teaching methods.

Use the declared Qitu contract resource for scope, owner handoff and lifecycle constraints.
