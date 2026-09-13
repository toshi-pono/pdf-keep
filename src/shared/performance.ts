/** Optional development instrumentation; no UI messages or retained samples. */
export type PerformanceSample = { stage: string; milliseconds: number };
let observer: ((sample: PerformanceSample) => void) | undefined;
export function observePerformance(next?: typeof observer) {
  observer = next;
}
export function measure<T>(stage: string, work: () => T): T {
  const receive = observer;
  if (!receive) return work();
  const now = () =>
    typeof performance === "undefined" ? Date.now() : performance.now();
  const start = now();
  const done = () => receive({ stage, milliseconds: now() - start });
  try {
    const result = work();
    if (result instanceof Promise) return result.finally(done) as T;
    done();
    return result;
  } catch (error) {
    done();
    throw error;
  }
}
