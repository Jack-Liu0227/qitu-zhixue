type MermaidRuntime = typeof import('mermaid')['default'];

let runtime: Promise<MermaidRuntime> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Mermaid shares a document-level renderer; serialize concurrent board renders. */
export function renderMermaid(id: string, source: string): Promise<string> {
  if (source.length > 30_000) return Promise.reject(new Error('Diagram is too large'));
  const job = queue.then(async () => {
    runtime ??= import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false },
        maxTextSize: 30_000,
        maxEdges: 200,
      });
      return mermaid;
    }).catch((error: unknown) => {
      runtime = undefined;
      throw error;
    });
    const mermaid = await runtime;
    const { svg } = await mermaid.render(id, source);
    return svg;
  });
  queue = job.catch(() => undefined);
  return job;
}
