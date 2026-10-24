import { ConflictException } from '@nestjs/common';
import type { TutorReplyBlock } from '@qitu/contracts';

function invalid(message = '教学活动候选不符合当前课时协议。', field = '/'): never {
  throw new ConflictException({ code: 'TUTOR_ACTIVITY_INVALID', message, field });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(`Only these fields are allowed: ${keys.join(', ')}.`);
}
function text(value: unknown, max: number, field: string): string {
  // Comparisons are learning content, not markup. React/KaTeX render text; graph labels are escaped below.
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /<\s*\/?\s*[a-z][^<>]*>|<!--|javascript:|data:|https?:\/\//iu.test(value)) invalid('Use bounded plain text or math, without markup or external content.', field);
  return value.trim();
}
export function buildActivityBoard(candidate: Record<string, unknown>, boardId: string): Extract<TutorReplyBlock, { kind: 'board' }> {
  exact(candidate, ['kind', 'title', 'steps']);
  const title = text(candidate.title, 100, '/title');
  if (!Array.isArray(candidate.steps) || !candidate.steps.length || candidate.steps.length > 5) invalid();
  const steps = candidate.steps.map((raw, index) => {
    const step = record(raw); exact(step, ['caption', 'nodes', 'edges', 'tex']);
    const caption = text(step.caption, 300, `/steps/${index}/caption`);
    let mermaid: string | undefined;
    let tex: string | undefined;
    if (step.edges !== undefined && step.nodes === undefined) invalid('Edges require their graph nodes.', `/steps/${index}/nodes`);
    if (step.nodes !== undefined) {
      if (!Array.isArray(step.nodes) || !step.nodes.length || step.nodes.length > 12 || !Array.isArray(step.edges) || step.edges.length > 20) invalid();
      const nodes = step.nodes.map((rawNode) => {
        const node = record(rawNode); exact(node, ['id', 'label']);
        const id = text(node.id, 40, `/steps/${index}/nodes/id`);
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(id)) invalid();
        return { id, label: text(node.label, 100, `/steps/${index}/nodes/label`).replace(/["\[\]{}|;`\\]/gu, ' ')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
      });
      if (new Set(nodes.map((node) => node.id)).size !== nodes.length) invalid();
      const edges = step.edges.map((rawEdge) => {
        const edge = record(rawEdge); exact(edge, ['from', 'to']);
        if (!nodes.some((node) => node.id === edge.from) || !nodes.some((node) => node.id === edge.to)) invalid();
        return `${edge.from} --> ${edge.to}`;
      });
      mermaid = ['flowchart LR', ...nodes.map((node) => `${node.id}["${node.label}"]`), ...edges].join('\n');
    }
    if (step.tex !== undefined) {
      tex = text(step.tex, 500, `/steps/${index}/tex`);
      if (/\\(?:href|url|html\w*|includegraphics|def|gdef|edef|newcommand|renewcommand|require|input|write)/iu.test(tex)) invalid('Use math only; no executable or external TeX commands.', `/steps/${index}/tex`);
    }
    return { caption, ...(mermaid ? { mermaid } : {}), ...(tex ? { tex } : {}) };
  });
  if (!steps.some(step => step.mermaid || step.tex)) invalid('Include at least one diagram or formula; other steps may ask the learner to predict or explain.', '/steps');
  return { kind: 'board', boardId, title, steps };
}

