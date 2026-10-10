import { describe, expect, it } from 'vitest';
import {
  canSendAgain,
  canStillConfirm,
  confirmedNotice,
  demoCustomerAfterConfirm,
  lineColumn,
  sendAgainNotice,
  sentAfterConfirm,
} from '../../admin/src/board';

const NOW = Date.parse('2026-10-05T00:00:00Z');
const AHEAD = '2026-10-10T14:00:00+09:00';
const OVER = '2026-10-01T14:00:00+09:00';
const row = (overrides: Partial<Parameters<typeof canSendAgain>[0]> = {}) => ({
  status: 'confirmed' as const,
  requestedFor: AHEAD,
  confirmationSent: false,
  ...overrides,
});

describe('Send again on the board', () => {
  it('shows on a confirmed visit still ahead whose LINE column says "not sent"', () => {
    expect(canSendAgain(row(), NOW)).toBe(true);
  });

  it.each([
    ['a request staff have not confirmed', { status: 'requested' as const }],
    ['a visit whose confirmation went out', { confirmationSent: true }],
    ['a visit that is over, as Strapi sends no confirmation for it', { requestedFor: OVER }],
    ["a demo customer's visit, as there is nothing to resend", { demoCustomer: true }],
  ])('hides on %s', (_label, overrides) => {
    expect(canSendAgain(row(overrides), NOW)).toBe(false);
  });
});

describe("Send again's notice", () => {
  it('says the confirmation was sent, or had been already', () => {
    expect(sendAgainNotice('APT-4821', 'sent')).toEqual({ type: 'success', message: 'Sent the LINE confirmation for APT-4821.' });
    expect(sendAgainNotice('APT-4821', 'already_sent')).toEqual({
      type: 'success',
      message: 'The LINE confirmation for APT-4821 had already been sent.',
    });
  });

  it("warns when LINE took it but Strapi couldn't record it, so the row still says \"not sent\"", () => {
    expect(sendAgainNotice('APT-4821', 'sent_unrecorded')).toEqual({
      type: 'warning',
      message: 'Sent the LINE confirmation for APT-4821, but it couldn\'t be recorded, so its row still says "not sent". Don\'t send it again.',
      blockTransition: true,
    });
  });

  // It says "Don't send it again", which has to be read: a notice that fades after a few seconds can be missed, as the
  // reply notices that carry the same words stay until they are dismissed (replyNotice).
  it("stays on screen until it is dismissed when it warns not to send it again", () => {
    expect(sendAgainNotice('APT-4821', 'sent_unrecorded').blockTransition).toBe(true);
  });

  it('fades as any notice does when it only reports a success', () => {
    expect(sendAgainNotice('APT-4821', 'sent')).not.toHaveProperty('blockTransition');
    expect(sendAgainNotice('APT-4821', 'already_sent')).not.toHaveProperty('blockTransition');
  });
});

describe('Confirm on the board', () => {
  it('shows on a request whose visit is still ahead, and on nothing else', () => {
    expect(canStillConfirm(row({ status: 'requested' }), NOW)).toBe(true);
    expect(canStillConfirm(row({ status: 'requested', requestedFor: OVER }), NOW)).toBe(false);
    expect(canStillConfirm(row(), NOW)).toBe(false);
  });
});

describe("Confirm's notice", () => {
  it('says the confirmation was sent when it was', () => {
    expect(confirmedNotice('APT-4821', true)).toEqual({
      type: 'success',
      message: "Confirmed APT-4821. The customer's LINE confirmation was sent.",
    });
  });

  it.each([false, undefined])('points to Send again when it was not, or nothing says (%s)', (sent) => {
    expect(confirmedNotice('APT-4821', sent)).toEqual({
      type: 'warning',
      message: "Confirmed APT-4821. The LINE confirmation wasn't sent; use Send again.",
    });
  });

  it("reads whether it was sent from confirm's answer, and from the reloaded row when the answer doesn't say", () => {
    const rows = [{ reference: 'APT-4821', confirmationSent: true }];
    expect(sentAfterConfirm({ appointment: { confirmationSent: false } }, rows, 'APT-4821')).toBe(false);
    expect(sentAfterConfirm({ appointment: { confirmationSent: true } }, null, 'APT-4821')).toBe(true);
    expect(sentAfterConfirm({}, rows, 'APT-4821')).toBe(true);
    expect(sentAfterConfirm(undefined, [], 'APT-4821')).toBeUndefined();
    expect(sentAfterConfirm({}, null, 'APT-4821')).toBeUndefined();
  });
});

describe('the LINE column', () => {
  it('says "LINE sent" in green once the confirmation went out', () => {
    expect(lineColumn({ confirmationSent: true, demoCustomer: false })).toEqual({ label: 'LINE sent', variant: 'success' });
  });

  it('says "not sent", in grey, until it has', () => {
    expect(lineColumn({ confirmationSent: false, demoCustomer: false })).toEqual({ label: 'not sent', variant: 'neutral' });
  });

  it("says \"demo customer\", in grey and never red, for a made-up customer's visit, which gets no LINE message", () => {
    expect(lineColumn({ confirmationSent: false, demoCustomer: true })).toEqual({ label: 'demo customer', variant: 'neutral' });
  });

  it('treats a row that does not say as a real customer\'s', () => {
    expect(lineColumn({ confirmationSent: false })).toEqual({ label: 'not sent', variant: 'neutral' });
  });
});

describe("Confirm's notice for a demo customer", () => {
  it('says plainly that no LINE message goes to a made-up customer, as an info notice, never a warning', () => {
    expect(confirmedNotice('APT-4821', false, true)).toEqual({ type: 'info', message: 'Confirmed APT-4821. Demo customer: no LINE message.' });
  });

  it("reads whether it is a demo customer's visit from confirm's answer, and from the reloaded row when the answer doesn't say", () => {
    const rows = [{ reference: 'APT-4821', confirmationSent: false, demoCustomer: true }];
    expect(demoCustomerAfterConfirm({ appointment: { demoCustomer: false } }, rows, 'APT-4821')).toBe(false);
    expect(demoCustomerAfterConfirm({ appointment: { demoCustomer: true } }, null, 'APT-4821')).toBe(true);
    expect(demoCustomerAfterConfirm({}, rows, 'APT-4821')).toBe(true);
    expect(demoCustomerAfterConfirm(undefined, [], 'APT-4821')).toBe(false);
  });
});

describe("Send again's notice for a demo customer", () => {
  it('says no LINE message goes to a made-up customer, as an info notice', () => {
    expect(sendAgainNotice('APT-4821', 'demo')).toEqual({ type: 'info', message: 'Demo customer: no LINE confirmation for APT-4821.' });
  });
});
