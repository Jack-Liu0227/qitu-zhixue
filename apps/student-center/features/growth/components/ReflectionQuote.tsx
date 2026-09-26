import type { ReactNode } from 'react';

/**
 * Module-local quote block for the child's own 自述/反思 (growth-spec.md §10:
 * `ReflectionQuote` is not shipped by `@qitu/ui`). It renders the student's own
 * server-provided summary only — never another adult's raw text.
 */
export function ReflectionQuote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="qitu-reflection-quote">
      <span className="qitu-reflection-mark" aria-hidden="true">
        「
      </span>
      <span className="qitu-reflection-text">{children}</span>
    </blockquote>
  );
}
