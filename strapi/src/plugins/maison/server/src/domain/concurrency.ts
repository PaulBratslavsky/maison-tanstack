/**
 * `work` for each item, with at most `limit` running at once, and each result in the order of the items. The items start
 * in order: each time one ends, the next starts. When one fails, the promise rejects with that failure at once, and no
 * item starts after it. The ones already running still end on their own.
 *
 * Load demo catalog writes the Japanese product knowledge this way: a remote database answers each write in tens of
 * milliseconds, so 32 writes one after another take seconds, and a few at a time stay well inside its connection pool.
 */
export const mapConcurrently = async <T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
};
