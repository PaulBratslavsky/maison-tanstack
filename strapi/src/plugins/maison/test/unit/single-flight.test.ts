import { describe, expect, it, vi } from 'vitest';
import { singleFlight } from '../../admin/src/singleFlight';

/** A promise a test settles by hand, so it decides when a call finishes. */
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets every promise that can settle without help settle: the calls a test made, and what they were waiting on. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('singleFlight', () => {
  it('runs the task with its arguments and answers what the task answers', async () => {
    const task = vi.fn(async (a: number, b: number) => a + b);
    const guarded = singleFlight(task);

    expect(await guarded(2, 3)).toBe(5);

    expect(task).toHaveBeenCalledExactlyOnceWith(2, 3);
  });

  it('ignores a call made while one is running: the task is not called again, and the call answers nothing at once', async () => {
    const running = deferred<string>();
    const task = vi.fn(() => running.promise);
    const guarded = singleFlight(task);

    const first = guarded();
    const second = await guarded(); // answers while the first is still running

    expect(second).toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
    running.resolve('sent');
    expect(await first).toBe('sent');
  });

  // A double click is two calls in the same turn, before anything has re-rendered.
  it('ignores every call made in the same turn, as a double click makes', async () => {
    const running = deferred();
    const task = vi.fn(() => running.promise);
    const guarded = singleFlight(task);

    const calls = [guarded(), guarded(), guarded()];

    expect(task).toHaveBeenCalledTimes(1);
    running.resolve();
    await Promise.all(calls);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not queue the call it ignored: it never runs later', async () => {
    const running = deferred();
    const task = vi.fn(() => running.promise);
    const guarded = singleFlight(task);

    const first = guarded();
    void guarded();
    running.resolve();
    await first;
    await settle();

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs again once the call before it has finished', async () => {
    const task = vi.fn(async (name: string) => name);
    const guarded = singleFlight(task);

    expect(await guarded('first')).toBe('first');
    expect(await guarded('second')).toBe('second');

    expect(task.mock.calls).toEqual([['first'], ['second']]);
  });

  it('is open to the next call at the moment the running one finishes, not before', async () => {
    const running = deferred();
    const task = vi.fn(() => running.promise);
    const guarded = singleFlight(task);

    const first = guarded();
    await settle();
    expect(await guarded()).toBeUndefined(); // still running, a whole turn later

    running.resolve();
    await first;
    void guarded();

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('runs again after a call that failed, and passes the failure on to the caller that made it', async () => {
    const task = vi.fn<(fail: boolean) => Promise<string>>(async (fail) => {
      if (fail) throw new Error('LINE refused it');
      return 'sent';
    });
    const guarded = singleFlight(task);

    await expect(guarded(true)).rejects.toThrow('LINE refused it');

    expect(await guarded(false)).toBe('sent');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('runs again after a task that threw before it returned a promise', async () => {
    const task = vi.fn((fail: boolean): Promise<string> => {
      if (fail) throw new Error('threw at once');
      return Promise.resolve('sent');
    });
    const guarded = singleFlight(task);

    await expect(guarded(true)).rejects.toThrow('threw at once');

    expect(await guarded(false)).toBe('sent');
  });

  it('runs again after a call that was rejected while another was ignored', async () => {
    const running = deferred();
    const task = vi.fn((): Promise<void> => running.promise);
    const guarded = singleFlight(task);

    const first = guarded();
    expect(await guarded()).toBeUndefined();
    running.reject(new Error('timed out'));
    await expect(first).rejects.toThrow('timed out');

    const next = deferred();
    task.mockReturnValueOnce(next.promise);
    const again = guarded();
    expect(task).toHaveBeenCalledTimes(2);
    next.resolve();
    await again;
  });

  it('keeps each guard to itself: two of them can run at the same time', async () => {
    const a = deferred();
    const b = deferred();
    const taskA = vi.fn(() => a.promise);
    const taskB = vi.fn(() => b.promise);
    const guardedA = singleFlight(taskA);
    const guardedB = singleFlight(taskB);

    const calls = [guardedA(), guardedB()];

    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).toHaveBeenCalledTimes(1);
    a.resolve();
    b.resolve();
    await Promise.all(calls);
  });

  it('guards one function for every action it is used for: a Close made while a reply is being sent does nothing', async () => {
    // The inquiries tab runs Send, Close, Change label and Label again through one guard, so only one request is in flight.
    const running = deferred();
    const request = vi.fn((_action: string): Promise<void> => running.promise);
    const run = singleFlight(request);

    const reply = run('reply');
    expect(await run('close')).toBeUndefined();
    expect(await run('label')).toBeUndefined();
    expect(await run('label-again')).toBeUndefined();

    expect(request.mock.calls).toEqual([['reply']]);
    running.resolve();
    await reply;
  });
});
