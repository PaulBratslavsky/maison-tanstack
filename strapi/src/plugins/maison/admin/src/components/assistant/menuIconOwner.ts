/**
 * Which menu icon looks after the assistant. Strapi draws Maison's menu icon more than once at the same time: in the left menu, and again in
 * the mobile menu while that is open (`MainNavIcons` and `MainNavBurgerMenuLinks` in @strapi/admin 5.57.0). The assistant is one chat, so only
 * one of those icons may look after it.
 *
 * Each icon claims when it mounts and releases when it unmounts. The owner is the oldest icon that has claimed and not released. When the owner
 * releases, the oldest icon that is left takes over. React's `useSyncExternalStore` reads `owner` and listens through `subscribe`.
 */
const claimers: string[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  // A copy, so a listener that unsubscribes while it is told does not skip the one after it.
  for (const listener of [...listeners]) listener();
};

/** The icon that looks after the assistant now, or null when no icon is on the screen. */
export const owner = (): string | null => claimers[0] ?? null;

/** An icon is on the screen. Claiming again with the same id changes nothing: React may run an effect twice in development. */
export const claim = (id: string): void => {
  if (claimers.includes(id)) return;
  const before = owner();
  claimers.push(id);
  if (owner() !== before) notify();
};

/** An icon has left the screen. An id that never claimed changes nothing. */
export const release = (id: string): void => {
  const index = claimers.indexOf(id);
  if (index === -1) return;
  const before = owner();
  claimers.splice(index, 1);
  if (owner() !== before) notify();
};

/** Calls `listener` each time the owner changes. Answers the function that stops it. */
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
