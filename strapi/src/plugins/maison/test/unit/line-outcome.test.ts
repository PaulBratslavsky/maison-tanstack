import { describe, expect, it } from 'vitest';
import { NO_TOKEN, lineDetailOf, reasonOf } from '../../server/src/domain/line-outcome';

const TOKEN = 'test-channel-token';

describe('NO_TOKEN', () => {
  it('says what staff can fix: the setting, and that Strapi cannot message customers without it', () => {
    expect(NO_TOKEN).toBe("LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.");
  });
});

describe('reasonOf', () => {
  it.each([
    ['an error, by its message', new Error('database is locked'), 'database is locked'],
    ['something that is not an error, as text', 'boom', 'boom'],
    ['an object with a message, by its message', { message: 'out of disk' }, 'out of disk'],
    ['nothing, as the word for it', undefined, 'undefined'],
  ])('gives %s', (_label, thrown, reason) => {
    expect(reasonOf(thrown, TOKEN)).toBe(reason);
  });

  it('takes every copy of the token out, wherever the error quotes it', () => {
    const error = new Error(`request to https://x.test/?access_token=${TOKEN} failed with "Bearer ${TOKEN}"`);
    expect(reasonOf(error, TOKEN)).toBe('request to https://x.test/?access_token=[token] failed with "Bearer [token]"');
  });
});

describe('lineDetailOf', () => {
  it('keeps a detail that fits, as one line', () => {
    expect(lineDetailOf('LINE answered 400:  The request\nbody has 1 error(s)', TOKEN)).toBe('LINE answered 400: The request body has 1 error(s)');
  });

  it('takes the token out', () => {
    expect(lineDetailOf(`LINE couldn't be reached: Headers.append: "Bearer ${TOKEN}" is an invalid header value.`, TOKEN)).toBe(
      'LINE couldn\'t be reached: Headers.append: "Bearer [token]" is an invalid header value.'
    );
  });

  it('takes the token out before it cuts, so no piece of it is left at the cut', () => {
    // "LINE answered 400: " is 19 units, so the token starts at unit 489. Cut first, it would leave "test-chann" there.
    const detail = lineDetailOf(`LINE answered 400: ${'a'.repeat(470)}${TOKEN}`, TOKEN);
    expect(detail).toBe(`LINE answered 400: ${'a'.repeat(470)}[token]`);
    expect(detail).not.toContain('test-c');
  });

  it('cuts to 500 UTF-16 units, the length of the rows it is recorded on: 500 stay whole and 501 are cut', () => {
    expect(lineDetailOf('x'.repeat(500), TOKEN)).toBe('x'.repeat(500));
    expect(lineDetailOf('x'.repeat(501), TOKEN)).toBe(`${'x'.repeat(499)}…`);
  });

  it('never splits an emoji when it cuts', () => {
    const detail = lineDetailOf('😀'.repeat(300), TOKEN);
    expect(detail).toBe(`${'😀'.repeat(249)}…`);
    expect(detail.length).toBeLessThanOrEqual(500);
  });
});
