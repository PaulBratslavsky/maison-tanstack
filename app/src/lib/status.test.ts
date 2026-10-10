import { describe, expect, it } from 'vitest';

import { COPY } from './copy';
import { SessionError } from './session';
import { errorDetail, errorOf, errorText, leadsHome, requestSentFor, statusLabel, statusTag } from './status';
import type { Appointment } from './types';

const visit = (overrides: Partial<Appointment> = {}): Appointment => ({
  reference: 'APT-0001',
  status: 'requested',
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
  note: '',
  confirmationSent: false,
  ...overrides,
});

describe('statusLabel', () => {
  it('says a requested visit is waiting for the boutique', () => {
    expect(statusLabel(visit(), 'en')).toBe('Awaiting the boutique');
    expect(statusLabel(visit(), 'ja')).toBe('ブティックの確認待ち');
  });

  it('says confirmed, and whether the LINE confirmation went out', () => {
    expect(statusLabel(visit({ status: 'confirmed' }), 'en')).toBe('Confirmed');
    expect(statusLabel(visit({ status: 'confirmed', confirmationSent: true }), 'en')).toBe('Confirmed · LINE sent');
  });
});

describe('statusTag (components/status-tag.tsx)', () => {
  it('outlines a visit awaiting the boutique, in the words the e2e specs look for', () => {
    expect(statusTag(visit(), 'en')).toEqual({ label: 'Awaiting the boutique', filled: false, lineSent: false });
    expect(statusTag(visit(), 'ja')).toEqual({ label: 'ブティックの確認待ち', filled: false, lineSent: false });
  });

  it('fills a confirmed visit, and adds the check once the LINE confirmation went out', () => {
    expect(statusTag(visit({ status: 'confirmed' }), 'en')).toEqual({ label: 'Confirmed', filled: true, lineSent: false });
    expect(statusTag(visit({ status: 'confirmed', confirmationSent: true }), 'ja')).toEqual({ label: '確定', filled: true, lineSent: true });
    expect([COPY.en.lineSent, COPY.ja.lineSent]).toEqual(['LINE sent', 'LINEで送信済み']);
  });

  it('shows no check on a request still awaiting the boutique, as statusLabel says nothing of LINE there', () => {
    expect(statusTag(visit({ confirmationSent: true }), 'en')).toEqual({ label: 'Awaiting the boutique', filled: false, lineSent: false });
    expect(statusLabel(visit({ confirmationSent: true }), 'en')).toBe('Awaiting the boutique');
  });
});

describe('errorText', () => {
  it("shows a known tool error's copy in the customer's language, never the tool's message", () => {
    const error = { code: 'not_found', message: 'No product with the slug "x". Call search_products.' };
    expect(errorText(error, 'en')).toBe("We couldn't find that.");
    expect(errorText(error, 'ja')).toBe('お探しのものは見つかりませんでした。');
  });

  it('has customer copy for an unreachable Maison (network) in both languages', () => {
    const error = { code: 'network', message: 'Failed to fetch' };
    expect(errorText(error, 'en')).toBe(COPY.en.errors.network);
    expect(errorText(error, 'ja')).toBe(COPY.ja.errors.network);
    expect(COPY.en.errors.network).not.toBe(COPY.ja.errors.network);
    expect(errorText(error, 'en')).not.toContain('Failed to fetch');
  });

  it('shows customer copy for server_error and the generic error code, not the raw English message', () => {
    expect(errorText({ code: 'server_error', message: 'Sign-in failed (500)' }, 'ja')).toBe(COPY.ja.errors.server_error);
    expect(errorText({ code: 'error', message: 'The tool failed.' }, 'ja')).toBe(COPY.ja.errors.error);
  });

  it('falls back to the generic copy for a code it does not know', () => {
    expect(errorText({ code: 'not_configured', message: 'LINE Messaging is not configured.' }, 'en')).toBe(COPY.en.errors.error);
    expect(errorText({ code: 'invalid_client', message: 'Unknown or inactive client' }, 'ja')).toBe(COPY.ja.errors.error);
  });

  it("treats names inherited from Object as unknown codes, not as copy", () => {
    for (const code of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(errorText({ code, message: 'x' }, 'en')).toBe(COPY.en.errors.error);
    }
  });

  it("names the boutique for boutique_closed when the screen passes its name, in the customer's language", () => {
    // The tool's own message names the boutique in the catalog's default language, whatever locale the request had.
    const closed = { code: 'boutique_closed', message: '銀座本店 is not open at 2026-10-03T21:00:00+09:00.' };
    expect(errorText(closed, 'en', 'Ginza Flagship')).toBe('Ginza Flagship is closed at that time.');
    expect(errorText(closed, 'ja', '銀座本店')).toBe('銀座本店はこの時間、営業時間外です。');
    expect(errorText(closed, 'en', 'Ginza Flagship')).not.toContain('銀座本店');
  });

  it('keeps the general closed-boutique copy without a name, and names no boutique in other errors', () => {
    const closed = { code: 'boutique_closed', message: '銀座本店 is not open at 2026-10-03T21:00:00+09:00.' };
    expect(errorText(closed, 'en')).toBe(COPY.en.errors.boutique_closed);
    expect(errorText(closed, 'ja', '')).toBe(COPY.ja.errors.boutique_closed);
    expect(errorText({ code: 'in_the_past', message: 'x' }, 'en', 'Ginza Flagship')).toBe(COPY.en.errors.in_the_past);
    expect(errorText({ code: 'too_many_open_requests', message: 'x' }, 'ja', '銀座本店')).toBe(COPY.ja.errors.too_many_open_requests);
  });

  it('says how long to wait when the server named a wait (Retry-After)', () => {
    const busy = { code: 'temporarily_unavailable', message: 'LINE sign-in could not be checked right now.' };
    expect(errorText({ ...busy, retryAfterSeconds: 5 }, 'en')).toBe(`${COPY.en.errors.temporarily_unavailable} ${COPY.en.tryAgainIn(5)}`);
    expect(errorText({ ...busy, retryAfterSeconds: 5 }, 'ja')).toBe(`${COPY.ja.errors.temporarily_unavailable} ${COPY.ja.tryAgainIn(5)}`);
    expect(errorText({ ...busy, retryAfterSeconds: null }, 'en')).toBe(COPY.en.errors.temporarily_unavailable);
    expect(errorText(busy, 'en')).toBe(COPY.en.errors.temporarily_unavailable);
  });
});

describe('tryAgainIn', () => {
  it('names the wait in seconds, and in whole minutes from a minute up', () => {
    expect(COPY.en.tryAgainIn(5)).toBe("That's about 5 seconds.");
    expect(COPY.en.tryAgainIn(1)).toBe("That's about 1 second.");
    expect(COPY.en.tryAgainIn(60)).toBe("That's about 1 minute.");
    expect(COPY.en.tryAgainIn(90)).toBe("That's about 2 minutes.");
    expect(COPY.ja.tryAgainIn(5)).toBe('目安は5秒ほどです。');
    expect(COPY.ja.tryAgainIn(120)).toBe('目安は2分ほどです。');
  });
});

describe('errorOf', () => {
  it("keeps a sign-in error's OAuth code, message and wait", () => {
    const error = new SessionError('temporarily_unavailable', 'LINE sign-in could not be checked right now.', 5);
    expect(errorOf(error)).toEqual({
      code: 'temporarily_unavailable',
      message: 'LINE sign-in could not be checked right now.',
      hint: '',
      retryAfterSeconds: 5,
    });
  });

  it('calls a failed fetch (a TypeError in every browser) network', () => {
    expect(errorOf(new TypeError('Failed to fetch'))).toEqual({ code: 'network', message: 'Failed to fetch', hint: '' });
    expect(errorOf(new TypeError('Load failed'))).toMatchObject({ code: 'network' });
  });

  it('calls anything else error, keeping its message', () => {
    expect(errorOf(new Error('VITE_MAISON_CLIENT_ID is not set.'))).toEqual({
      code: 'error',
      message: 'VITE_MAISON_CLIENT_ID is not set.',
      hint: '',
    });
    expect(errorOf('boom')).toEqual({ code: 'error', message: 'boom', hint: '' });
  });
});

describe('errorDetail (the mock-mode technical line)', () => {
  it('names the likely fix for an unreachable Strapi', () => {
    const detail = errorDetail({ code: 'network', message: 'Failed to fetch' });
    expect(detail).toMatch(/^Failed to fetch: Is Strapi running on http:\/\/\S+\? /);
    expect(detail).toContain('Open the app at http://localhost:3004, not 127.0.0.1.');
  });

  it("keeps the server's message for invalid_grant and points at the mode: in mock mode, Strapi doesn't trust the mock's tokens", () => {
    // Strapi left in LINE mode, or not restarted after `npm run mode:local`: npm run setup doesn't fix that.
    const detail = errorDetail({ code: 'invalid_grant', message: 'The LINE ID token is invalid or expired' });
    expect(detail).toBe('The LINE ID token is invalid or expired: Check npm run mode; after a switch, restart Strapi and the app.');
  });

  it("names the fix when the app's OAuth client isn't active (setup re-run, app not restarted)", () => {
    expect(errorDetail({ code: 'invalid_client', message: 'Unknown or inactive client' })).toBe(
      "Unknown or inactive client: The app's OAuth client isn't active in Strapi. Run `npm run setup` and restart the app."
    );
  });

  it('shows the raw message alone when there is no known fix, inherited names included', () => {
    expect(errorDetail({ code: 'boutique_closed', message: 'Ginza is closed then.' })).toBe('Ginza is closed then.');
    expect(errorDetail({ code: 'constructor', message: 'x' })).toBe('x');
    expect(errorDetail({ code: 'error', message: '' })).toBeNull();
  });
});

describe('leadsHome', () => {
  it('leads home from not_found, which trying again cannot fix', () => {
    expect(leadsHome('not_found', false)).toBe(true);
    expect(leadsHome('not_found', true)).toBe(true);
  });

  it('leads home from invalid_input only when the input came from the URL', () => {
    expect(leadsHome('invalid_input', true)).toBe(true);
    expect(leadsHome('invalid_input', false)).toBe(false);
  });

  it('offers a retry for everything else', () => {
    expect(leadsHome('network', true)).toBe(false);
    expect(leadsHome('error', true)).toBe(false);
  });
});

describe('requestSentFor', () => {
  const visits = [visit({ reference: 'APT-0001' }), visit({ reference: 'APT-0002', status: 'confirmed' })];

  it('is true only when the list holds that reference, still waiting for the boutique', () => {
    expect(requestSentFor(visits, 'APT-0001')).toBe(true);
  });

  it('is false for a confirmed visit, a reference not in the list, no reference, or no list yet', () => {
    expect(requestSentFor(visits, 'APT-0002')).toBe(false);
    expect(requestSentFor(visits, 'APT-9999')).toBe(false);
    expect(requestSentFor(visits, null)).toBe(false);
    expect(requestSentFor(undefined, 'APT-0001')).toBe(false);
  });
});
