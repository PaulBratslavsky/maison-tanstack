/** Short, human-readable reference for a visit (APT) or a question (Q). Uniqueness is checked by the caller. */
export const generateReference = (random: () => number = Math.random, prefix: 'APT' | 'Q' = 'APT'): string =>
  `${prefix}-${1000 + Math.floor(random() * 9000)}`;
