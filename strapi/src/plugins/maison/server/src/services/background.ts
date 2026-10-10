/*
 * The demo buttons' work in the background. Load demo catalog and Load demo activity answer at once and do their writes
 * afterwards: on Strapi Cloud each write goes to a remote database, and a press that waited for all of them took long
 * enough for Cloud's proxy to give up and answer an HTML error page.
 */

/** Runs `log`, and drops anything it throws: a log line must never fail the work, or escape as an unhandled rejection. */
const safely = (log: () => void): void => {
  try {
    log();
  } catch {
    // Nothing more can be done about a log that failed.
  }
};

export interface BackgroundHooks<T> {
  /** Called once the work has ended, whether it finished or failed, before anyone awaiting it hears: it clears the button's flag. */
  release: () => void;
  /** Logs what the work did. */
  finished: (result: T) => void;
  /** Logs why the work stopped. */
  failed: (error: unknown) => void;
}

/**
 * `work`, started now, in the background. It answers the work's promise, which a test or a caller that wants the result
 * may await. Nobody has to: the promise is handled here, so a failure is logged by `failed` and never escapes as an
 * unhandled rejection, which would stop the Node process.
 */
export const inBackground = <T>(work: () => Promise<T>, { release, finished, failed }: BackgroundHooks<T>): Promise<T> => {
  const running = (async () => {
    try {
      return await work();
    } finally {
      release();
    }
  })();
  running.then(
    (result) => safely(() => finished(result)),
    (error) => safely(() => failed(error))
  );
  return running;
};
