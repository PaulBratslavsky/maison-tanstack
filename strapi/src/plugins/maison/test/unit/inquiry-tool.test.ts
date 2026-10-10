import { describe, expect, it, vi } from 'vitest';
import { ACTION } from '../../server/src/constants';
import { notSignedIn } from '../../server/src/mcp/common';
import { localeInput, logInquiryInput } from '../../server/src/mcp/schemas';
import { logInquiryTool } from '../../server/src/mcp/tools/log-inquiry';
import { extraWith, fakeStrapi } from './fake-strapi';

const SUBJECT = `line:U${'a'.repeat(32)}`;
const context = { userAbility: {} as any, user: { id: 1 } };
const args = { message: 'Can the coffret hold a watch?', knowledgeFound: false, handedOff: true };
const errorOf = (result: any) => JSON.parse(result.content[0].text).error;

const setup = (subject: string | null, inquiries: Record<string, unknown>) => {
  const identity = { getCustomerSubject: vi.fn(async () => subject) };
  return { strapi: fakeStrapi({ services: { identity, inquiries } }), identity };
};
const call = (strapi: any, callArgs: Record<string, unknown> = args, extra: any = extraWith({ authorization: 'Bearer mcp_at_x' })) =>
  logInquiryTool.createHandler(strapi, context)({ args: callArgs, extra });

describe('log_inquiry', () => {
  it('is called log_inquiry, and needs the permission to log inquiries: inquiries.log, and only that', () => {
    expect(logInquiryTool.name).toBe('log_inquiry');
    expect(ACTION.inquiriesLog).toBe('plugin::maison.inquiries.log');
    expect(logInquiryTool.auth.policies).toEqual([{ action: ACTION.inquiriesLog }]);
  });

  it("says it is for the app's server after each turn, not for the concierge, and that the customer comes from their sign-in", () => {
    const { description } = logInquiryTool;
    for (const part of ["Maison's staff", 'after each turn', 'not for the concierge to call', 'LINE sign-in, never from an argument']) {
      expect(description, part).toContain(part);
    }
  });

  it('returns the shared not-signed-in error, and never calls the service, when there is no customer', async () => {
    const log = vi.fn();
    const { strapi } = setup(null, { log });

    const result = await call(strapi, args, extraWith({ authorization: 'Bearer admin-token' }));

    expect(result).toEqual(notSignedIn());
    expect((result as any).isError).toBe(true);
    expect(errorOf(result).code).toBe('not_signed_in');
    expect(log).not.toHaveBeenCalled();
  });

  it("passes the session's subject and the arguments, and answers { logged: true }", async () => {
    const log = vi.fn(async () => ({ ok: true, value: { logged: true } }));
    const { strapi, identity } = setup(SUBJECT, { log });
    const extra = extraWith({ authorization: 'Bearer mcp_at_x' });
    const full = {
      message: 'Can the coffret hold a watch?',
      reply: "I'll pass this to our team.",
      knowledgeFound: false,
      handedOff: true,
      questionReference: 'Q-4821',
      productSlug: 'jewelry-coffret',
      locale: 'en',
    };

    const result: any = await call(strapi, full, extra);

    expect(identity.getCustomerSubject).toHaveBeenCalledWith(extra);
    expect(log).toHaveBeenCalledExactlyOnceWith({ subject: SUBJECT, ...full });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ logged: true });
    expect(JSON.parse(result.content[0].text)).toEqual({ logged: true });
    expect(logInquiryTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({ logged: true });
  });

  it('takes the customer from the session, even when an argument names another one', async () => {
    const log = vi.fn(async () => ({ ok: true, value: { logged: true } }));
    const { strapi } = setup(SUBJECT, { log });
    const somebodyElse = `line:U${'b'.repeat(32)}`;

    // The schema drops a field it doesn't have, so a call like this normally never reaches the handler. This is the second lock.
    await call(strapi, { ...args, subject: somebodyElse });

    expect(log).toHaveBeenCalledOnce();
    expect((log.mock.calls[0] as any[])[0].subject).toBe(SUBJECT);
  });

  it('turns a service failure into a tool error with the same code, message and hint', async () => {
    const failure = { ok: false, code: 'invalid_input', message: 'Nothing to log.', hint: 'Give a message.' };
    const log = vi.fn(async () => failure);
    const { strapi } = setup(SUBJECT, { log });

    const result: any = await call(strapi);

    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual({ code: failure.code, message: failure.message, hint: failure.hint });
    expect(result.structuredContent).toBeUndefined();
  });

  it('validates with the shared schema object, whose locale is the same one every customer tool takes', () => {
    expect(logInquiryTool.resolveInputSchema!(context)).toBe(logInquiryInput);
    expect(logInquiryInput.shape.locale).toBe(localeInput);
  });

  it('answers only { logged: true }', () => {
    const output = logInquiryTool.resolveOutputSchema(context);
    expect(output.safeParse({ logged: true }).success).toBe(true);
    expect(output.safeParse({ logged: false }).success).toBe(false);
    expect(output.safeParse({}).success).toBe(false);
  });
});
