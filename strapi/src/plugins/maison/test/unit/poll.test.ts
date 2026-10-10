import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPolling } from '../../admin/src/poll';

const INTERVAL = 5000;

/** A load that stays in flight until the test settles it, like a request to a slow server. */
const slowLoads = () => {
  const inFlight: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const load = vi.fn(() => new Promise<void>((resolve, reject) => inFlight.push({ resolve, reject })));
  return { load, inFlight };
};

describe('startPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads at once, then times the next load from when the last one finished, so loads never overlap', async () => {
    const { load, inFlight } = slowLoads();
    const stop = startPolling(load, INTERVAL);
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(load, 'no second load while the first is in flight').toHaveBeenCalledTimes(1);

    inFlight[0].resolve();
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps polling after a load fails', async () => {
    const { load, inFlight } = slowLoads();
    const stop = startPolling(load, INTERVAL);
    inFlight[0].reject(new Error('502 Bad Gateway'));
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('schedules nothing after stopping, even when a load was in flight', async () => {
    const { load, inFlight } = slowLoads();
    const stop = startPolling(load, INTERVAL);
    stop();
    inFlight[0].resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancels the waiting load when stopped between loads', async () => {
    const { load, inFlight } = slowLoads();
    const stop = startPolling(load, INTERVAL);
    inFlight[0].resolve();
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
