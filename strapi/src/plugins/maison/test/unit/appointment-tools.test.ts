import { describe, expect, it, vi } from 'vitest';
import { myAppointmentsTool } from '../../server/src/mcp/tools/my-appointments';
import { requestAppointmentTool } from '../../server/src/mcp/tools/request-appointment';
import { extraWith, fakeStrapi } from './fake-strapi';

const SUBJECT = `line:U${'a'.repeat(32)}`;
const context = { userAbility: {} as any, user: { id: 1 } };
const view = {
  reference: 'APT-4821', status: 'requested', boutique: { slug: 'ginza', name: '銀座本店' },
  requestedFor: '2026-10-10T14:00:00+09:00', products: [{ slug: 'weekender-50', name: 'ウィークエンダー 50' }],
  note: '', confirmationSent: false,
};
const args = { boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: '2026-10-10T14:00:00+09:00' };
const errorOf = (result: any) => JSON.parse(result.content[0].text).error;

const setup = (subject: string | null, appointments: Record<string, unknown>) => {
  const identity = { getCustomerSubject: vi.fn(async () => subject) };
  return { strapi: fakeStrapi({ services: { identity, appointments } }), identity };
};

describe('request_appointment', () => {
  it('returns not_signed_in and never calls the service when there is no customer', async () => {
    const request = vi.fn();
    const { strapi } = setup(null, { request });
    const result = await requestAppointmentTool.createHandler(strapi, context)({ args, extra: extraWith({ authorization: 'Bearer admin-token' }) });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe('not_signed_in');
    expect(request).not.toHaveBeenCalled();
  });

  it('passes the verified subject, and marks calls from the concierge', async () => {
    const request = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi, identity } = setup(SUBJECT, { request });
    const extra = extraWith({ authorization: 'Bearer mcp_at_x', 'x-maison-surface': 'concierge' });
    const result = await requestAppointmentTool.createHandler(strapi, context)({ args, extra });
    expect(identity.getCustomerSubject).toHaveBeenCalledWith(extra);
    expect(request).toHaveBeenCalledWith({ subject: SUBJECT, ...args, note: undefined, createdVia: 'concierge' });
    expect(requestAppointmentTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({ appointment: view });
  });

  it("asks for the names in the customer's language, and leaves the default to the service without one", async () => {
    const request = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi } = setup(SUBJECT, { request });
    const handler = requestAppointmentTool.createHandler(strapi, context);
    await handler({ args: { ...args, locale: 'en' }, extra: extraWith({ authorization: 'Bearer t' }) });
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ subject: SUBJECT, locale: 'en' }));
    await handler({ args, extra: extraWith({ authorization: 'Bearer t' }) });
    expect(request.mock.calls[1][0].locale).toBeUndefined();
  });

  it('takes a locale the way the other customer tools do: ja or en', () => {
    const input = requestAppointmentTool.resolveInputSchema!(context);
    expect(input.safeParse({ ...args, locale: 'en' }).data?.locale).toBe('en');
    const french = input.safeParse({ ...args, locale: 'fr' });
    expect(french.success).toBe(false);
    expect(french.error?.issues[0].path).toEqual(['locale']);
  });

  it('marks every other call as app', async () => {
    const request = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi } = setup(SUBJECT, { request });
    await requestAppointmentTool.createHandler(strapi, context)({ args, extra: extraWith({ authorization: 'Bearer t', 'x-maison-surface': 'something' }) });
    expect(request.mock.calls[0][0].createdVia).toBe('app');
  });

  it('turns a service failure into a tool error with the same code and hint', async () => {
    const request = vi.fn(async () => ({ ok: false, code: 'boutique_closed', message: 'Closed.', hint: 'Closed all day on Tuesday.' }));
    const { strapi } = setup(SUBJECT, { request });
    const result = await requestAppointmentTool.createHandler(strapi, context)({ args, extra: extraWith({ authorization: 'Bearer t' }) });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual({ code: 'boutique_closed', message: 'Closed.', hint: 'Closed all day on Tuesday.' });
  });

  it('rejects times without an offset, empty product lists and long notes', () => {
    const input = requestAppointmentTool.resolveInputSchema!(context);
    expect(input.safeParse(args).success).toBe(true);
    expect(input.safeParse({ ...args, requestedFor: '2026-10-10T14:00:00' }).success).toBe(false);
    expect(input.safeParse({ ...args, productSlugs: [] }).success).toBe(false);
    expect(input.safeParse({ ...args, productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    expect(input.safeParse({ ...args, note: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects a day that is not on the calendar, or the hour 24, instead of booking another day', () => {
    const input = requestAppointmentTool.resolveInputSchema!(context);
    // new Date() would turn 31 September into 1 October, and T24:00 into midnight of the next day.
    const september31 = input.safeParse({ ...args, requestedFor: '2026-09-31T14:00:00+09:00' });
    expect(september31.success).toBe(false);
    expect(september31.error?.issues[0]).toMatchObject({ path: ['requestedFor'], message: 'Not a real calendar date.' });
    expect(input.safeParse({ ...args, requestedFor: '2026-10-10T24:00:00+09:00' }).success).toBe(false);
  });
});

describe('my_appointments', () => {
  it('returns not_signed_in without a customer', async () => {
    const { strapi } = setup(null, { listForCustomer: vi.fn() });
    const result = await myAppointmentsTool.createHandler(strapi, context)({ args: {}, extra: extraWith({}) });
    expect(errorOf(result).code).toBe('not_signed_in');
  });

  it("lists the caller's appointments in the requested locale", async () => {
    const listForCustomer = vi.fn(async () => [view]);
    const { strapi } = setup(SUBJECT, { listForCustomer });
    const result = await myAppointmentsTool.createHandler(strapi, context)({ args: { locale: 'en' }, extra: extraWith({ authorization: 'Bearer t' }) });
    expect(listForCustomer).toHaveBeenCalledWith(SUBJECT, 'en');
    expect(myAppointmentsTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({ appointments: [view] });
  });
});
