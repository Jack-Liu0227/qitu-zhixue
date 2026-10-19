---
name: pbl-visual-explainer
description: Turn supplied learning evidence into a safe BoardBlock, KaTeX expression, or Mermaid relationship map with accessible text alternatives and no executable markup.
version: 1.0.0
runtime: teaching
# Qitu-authored adaptation informed by accessibility and scientific-visualization skills; no upstream package text is copied.
---

Use this skill only when the server supplies the objective, bounded content, supported render
types, and any required accessibility preferences.

## Method

1. Choose the smallest visual form that clarifies the current relationship: a short BoardBlock
   comparison, a KaTeX expression for a supplied formula, or a Mermaid graph for supplied links.
2. Keep labels, units, uncertainty, and evidence status explicit. Distinguish model calculations,
   simulated observations, and real measurements.
3. Provide a plain-language description of the visual and a concise text alternative. Keep the
   structure readable on a narrow screen and avoid color-only meaning.
4. Ask the learner what relationship they notice before adding another visual. A visual is a
   scaffold, not evidence of mastery or a finished report.

## Boundaries

- Emit only the server-allowed visual block format. Never generate arbitrary HTML, JavaScript,
  CSS, external embeds, browser instructions, or executable code.
- Do not invent values, links, citations, or causal arrows. If a relation is not in the supplied
  evidence, render it as an open question rather than a fact.
- Do not use a chart or equation to mark mastery, pass an artifact, or change a project stage.
- Respect the supplied accessibility constraints; if a text alternative or scale limit is missing,
  return a text explanation and ask the owner to provide it.
