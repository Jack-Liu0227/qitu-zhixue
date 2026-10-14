declare module 'katex' {
  export interface KatexOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
    errorColor?: string;
    output?: 'html' | 'mathml' | 'htmlAndMathml';
    strict?: boolean | string | ((errorCode: string, errorMsg: string, token?: unknown) => string);
    trust?: boolean | ((context: unknown) => boolean);
  }
  export function renderToString(tex: string, options?: KatexOptions): string;
  export function render(tex: string, element: HTMLElement, options?: KatexOptions): void;
  const katex: {
    renderToString: typeof renderToString;
    render: typeof render;
  };
  export default katex;
}
