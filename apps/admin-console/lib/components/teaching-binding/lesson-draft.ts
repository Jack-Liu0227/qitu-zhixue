/** Stable comparison for JSONB readbacks; property ordering is not a course change. */
export function canonicalCourseJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCourseJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalCourseJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
