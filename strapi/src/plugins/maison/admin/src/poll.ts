/**
 * Calls `load` now, then again `intervalMs` after each call has finished, so two loads never overlap, however slow
 * the server is. A failed load doesn't stop the polling. Returns `stop`: a load already in flight finishes, but
 * nothing is scheduled after it.
 */
export function startPolling(load: () => Promise<unknown>, intervalMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    try {
      await load();
    } catch {
      // `load` reports its own errors; the next tick tries again.
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
