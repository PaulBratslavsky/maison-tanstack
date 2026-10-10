/**
 * Wraps `task` so that one call runs at a time. A call made while another is running does nothing: it doesn't call
 * `task`, isn't queued for later, and answers `undefined` at once. That is what a button needs when its action must
 * happen once however fast it is pressed: the server has no guard against a second click, so a reply sent twice would
 * reach the customer twice, and a disabled button only closes the gap once the page has rendered again.
 *
 * The next call runs as soon as the running one has settled, whether it answered or failed. A failure goes to the
 * caller that made that call, as `task` threw it.
 */
export function singleFlight<Args extends unknown[], Result>(
  task: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result | undefined> {
  let running = false;

  return async (...args) => {
    if (running) return undefined;
    // Set before anything is awaited, so a second call in the same turn finds it set.
    running = true;
    try {
      return await task(...args);
    } finally {
      running = false;
    }
  };
}
