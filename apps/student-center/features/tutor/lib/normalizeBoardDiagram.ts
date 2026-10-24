/** Repair identifiers only in the closed graph format emitted by the activity owner. */
export function normalizeBoardDiagram(source: string): string {
  const lines = source.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== 'flowchart LR') return source;
  const nodes = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const node = /^([a-zA-Z][a-zA-Z0-9_]*)\["([^"\r\n]*)"\]$/u.exec(line);
    if (node) {
      if (nodes.has(node[1]!)) return source;
      nodes.set(node[1]!, `qitu_node_${nodes.size}`);
    } else if (!/^[a-zA-Z][a-zA-Z0-9_]* --> [a-zA-Z][a-zA-Z0-9_]*$/u.test(line)) return source;
  }
  if (!nodes.size) return source;
  const output = ['flowchart LR'];
  for (const line of lines.slice(1)) {
    const node = /^([a-zA-Z][a-zA-Z0-9_]*)\["([^"\r\n]*)"\]$/u.exec(line);
    if (node) output.push(`${nodes.get(node[1]!)}["${node[2]}"]`);
    else {
      const [from, to] = line.split(' --> ');
      if (!nodes.has(from!) || !nodes.has(to!)) return source;
      output.push(`${nodes.get(from!)} --> ${nodes.get(to!)}`);
    }
  }
  return output.join('\n');
}
