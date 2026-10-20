declare module 'mermaid' {
  interface MermaidRuntime {
    initialize(config: Record<string, unknown>): void;
    render(id: string, source: string): Promise<{ svg: string }>;
  }

  const mermaid: MermaidRuntime;
  export default mermaid;
}
