import { Compile } from 'typebox/compile';

export interface ToolArgumentIssue { path: string; rule: string }
type Schema = Record<string, unknown>;
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);

/** Diagnostics only: the original, complete schema remains the execution boundary. */
export function describeToolArguments(schema: Schema, args: unknown): { issues: ToolArgumentIssue[]; fields: string[] } {
  let selected = schema;
  if (object(args) && typeof args.kind === 'string' && Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch): branch is Schema => object(branch) && object(branch.properties)
      && object(branch.properties.kind) && branch.properties.kind.const === args.kind);
    if (matches.length === 1) selected = matches[0]!;
  }
  const known = new Set<string>();
  function collect(value: unknown): void {
    if (!object(value)) return;
    if (object(value.properties)) for (const [key, child] of Object.entries(value.properties)) { known.add(key); collect(child); }
    collect(value.items);
    for (const name of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(value[name])) value[name].forEach(collect);
  }
  collect(schema);
  const safePath = (path: string) => path.split('/').slice(1, 9)
    .map(part => known.has(part) || /^\d{1,5}$/.test(part) ? part : '$extra').join('/');
  const issues: ToolArgumentIssue[] = [];
  for (const error of Compile(selected).Errors(args)) {
    const missing = error.keyword === 'required' && Array.isArray(error.params.requiredProperties)
      ? error.params.requiredProperties.filter((v): v is string => typeof v === 'string' && known.has(v)) : [];
    for (const path of missing.length ? missing.map(name => `${error.instancePath}/${name}`) : [error.instancePath]) {
      const issue = { path: '/' + safePath(path), rule: error.keyword };
      if (!issues.some(previous => previous.path === issue.path && previous.rule === issue.rule)) issues.push(issue);
    }
    if (issues.length >= 8) break;
  }
  const fields = object(selected.properties) ? Object.keys(selected.properties).filter(name => /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(name)) : [];
  return { issues: issues.slice(0, 8), fields };
}
