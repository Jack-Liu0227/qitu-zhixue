/** Drain tool events while the model is still running; preserve order on success and failure. */
export async function* toolEventStream<Event, Result>(
  start: (emit: (event: Event) => void) => Promise<Result>,
): AsyncGenerator<Event, Result, undefined> {
  const queue: Event[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  let outcome: { result: Result } | { error: unknown } | undefined;
  const pending = start(event => { queue.push(event); wake?.(); }).then(
    result => { outcome = { result }; }, error => { outcome = { error }; },
  ).finally(() => { settled = true; wake?.(); });
  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (settled) break;
    await new Promise<void>(resolve => { wake = resolve; });
    wake = undefined;
  }
  await pending;
  if (!outcome) throw new Error('MODEL_RESULT_MISSING');
  if ('error' in outcome) throw outcome.error;
  return outcome.result;
}
