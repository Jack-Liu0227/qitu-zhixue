import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBoardDiagram } from './normalizeBoardDiagram';

test('persisted owner diagrams preserve labels and edges while replacing reserved node names', () => {
  const source = 'flowchart LR\nstart["start to end"]\nend["结束"]\nqitu_node_0["third"]\nstart --> end\nend --> qitu_node_0';
  const normalized = normalizeBoardDiagram(source);
  assert.equal(normalized, 'flowchart LR\nqitu_node_0["start to end"]\nqitu_node_1["结束"]\nqitu_node_2["third"]\nqitu_node_0 --> qitu_node_1\nqitu_node_1 --> qitu_node_2');
  assert.equal(normalizeBoardDiagram(normalized), normalized);
});

test('normalization leaves other Mermaid grammars and invalid graphs to the strict renderer', () => {
  for (const source of ['flowchart LR\nsubgraph group\na["A"]\nend', 'sequenceDiagram\nA->>B: end',
    'flowchart LR\na["A"]\na --> missing', 'flowchart LR\na["A"]\na["duplicate"]',
    'flowchart LR\na["A"]\nclick a "https://example.invalid"']) assert.equal(normalizeBoardDiagram(source), source);
});
