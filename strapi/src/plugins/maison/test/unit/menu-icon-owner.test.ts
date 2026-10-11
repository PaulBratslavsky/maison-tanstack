import { afterEach, describe, expect, it, vi } from 'vitest';
import { claim, owner, release, subscribe } from '../../admin/src/components/assistant/menuIconOwner';

/**
 * The owner rule is module state, so each test releases what it claimed. Strapi draws Maison's menu icon more than once at the same time
 * (the left menu, and the mobile menu while it is open), and the assistant must be drawn once.
 */
const claimed = new Set<string>();
const take = (id: string) => {
  claimed.add(id);
  claim(id);
};
afterEach(() => {
  for (const id of claimed) release(id);
  claimed.clear();
});

describe('the menu icon owner', () => {
  it('is nobody while no icon has claimed', () => {
    expect(owner()).toBeNull();
  });

  it('is the first icon to claim, however many claim after it', () => {
    take('left-menu');
    take('mobile-menu');
    take('third');
    expect(owner()).toBe('left-menu');
  });

  it('passes the ownership to the oldest icon that is left when the owner releases, one icon at a time, and to nobody after the last', () => {
    take('a');
    take('b');
    take('c');

    release('a');
    expect(owner()).toBe('b');
    release('b');
    expect(owner()).toBe('c');
    release('c');
    expect(owner()).toBeNull();
  });

  it('changes nothing when an icon that is not the owner releases, and the icon that was between them is gone for good', () => {
    take('a');
    take('b');
    take('c');

    release('b');
    expect(owner()).toBe('a');
    release('a');
    expect(owner()).toBe('c');
  });

  it('changes nothing when an icon that never claimed releases', () => {
    take('a');
    release('never-claimed');
    expect(owner()).toBe('a');
  });

  it('counts an icon once when it claims twice, as React does when it runs an effect again in development', () => {
    take('a');
    take('a');
    take('b');
    release('a');
    expect(owner()).toBe('b');
  });

  it('puts an icon that claims again after it released behind the icons that are still there', () => {
    take('a');
    take('b');
    release('a');
    take('a');
    expect(owner()).toBe('b');
  });

  // Strapi makes the icon again each time its menu draws, so one icon releases and the next claims within the same moment.
  it('makes the new icon the owner when the only icon releases and another claims straight after', () => {
    take('before-the-route-change');
    release('before-the-route-change');
    take('after-the-route-change');
    expect(owner()).toBe('after-the-route-change');
  });

  describe('subscribe', () => {
    it('tells a subscriber each time the owner changes, and only then', () => {
      const listener = vi.fn();
      const stop = subscribe(listener);

      take('a');
      expect(listener).toHaveBeenCalledTimes(1);
      take('b'); // not the owner: nothing changes
      expect(listener).toHaveBeenCalledTimes(1);
      release('b'); // not the owner either
      expect(listener).toHaveBeenCalledTimes(1);
      take('c');
      release('a'); // the owner changes from a to c
      expect(listener).toHaveBeenCalledTimes(2);
      release('c'); // and from c to nobody
      expect(listener).toHaveBeenCalledTimes(3);
      stop();
    });

    it('has the new owner ready when the subscriber is told', () => {
      const seen: Array<string | null> = [];
      const stop = subscribe(() => seen.push(owner()));
      take('a');
      take('b');
      release('a');
      release('b');
      stop();
      expect(seen).toEqual(['a', 'b', null]);
    });

    it('stops telling a subscriber that has unsubscribed', () => {
      const listener = vi.fn();
      const stop = subscribe(listener);
      stop();
      take('a');
      expect(listener).not.toHaveBeenCalled();
    });

    it('tells every subscriber, and lets one of them unsubscribe while it is being told', () => {
      const second = vi.fn();
      const stopFirst = subscribe(() => stopFirst());
      const stopSecond = subscribe(second);
      take('a');
      expect(second).toHaveBeenCalledTimes(1);
      stopSecond();
    });
  });
});
