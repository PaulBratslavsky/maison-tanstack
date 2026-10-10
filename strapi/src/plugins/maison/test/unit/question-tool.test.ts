import { describe, expect, it, vi } from 'vitest';
import { ACTION } from '../../server/src/constants';
import { notSignedIn } from '../../server/src/mcp/common';
import { handOffToStaffInput, localeInput } from '../../server/src/mcp/schemas';
import { handOffToStaffTool } from '../../server/src/mcp/tools/hand-off-to-staff';
import { extraWith, fakeStrapi } from './fake-strapi';

const SUBJECT = `line:U${'a'.repeat(32)}`;
const context = { userAbility: {} as any, user: { id: 1 } };
const view = { reference: 'Q-4821', status: 'open', product: { slug: 'jewelry-coffret', name: 'Jewelry Coffret' } };
const args = { question: 'Can the coffret hold a watch?' };
const errorOf = (result: any) => JSON.parse(result.content[0].text).error;

const setup = (subject: string | null, questions: Record<string, unknown>) => {
  const identity = { getCustomerSubject: vi.fn(async () => subject) };
  return { strapi: fakeStrapi({ services: { identity, questions } }), identity };
};
const call = (strapi: any, callArgs: Record<string, unknown> = args, extra: any = extraWith({ authorization: 'Bearer mcp_at_x' })) =>
  handOffToStaffTool.createHandler(strapi, context)({ args: callArgs, extra });

describe('hand_off_to_staff', () => {
  it('is called hand_off_to_staff, and needs the permission to ask staff: questions.ask, and only that', () => {
    expect(handOffToStaffTool.name).toBe('hand_off_to_staff');
    expect(ACTION.questionsAsk).toBe('plugin::maison.questions.ask');
    expect(handOffToStaffTool.auth.policies).toEqual([{ action: ACTION.questionsAsk }]);
  });

  it('tells the model when to hand off, and that the customer comes from their sign-in', () => {
    const { description } = handOffToStaffTool;
    // "no_answer" when search_knowledge has nothing, "asked_for_person" when the customer asks for a person.
    for (const part of ['search_knowledge', '"no_answer"', '"asked_for_person"', 'productSlug', 'LINE sign-in, never from an argument']) {
      expect(description, part).toContain(part);
    }
  });

  it('returns the shared not-signed-in error, and never calls the service, when there is no customer', async () => {
    const ask = vi.fn();
    const { strapi } = setup(null, { ask });

    const result = await call(strapi, args, extraWith({ authorization: 'Bearer admin-token' }));

    expect(result).toEqual(notSignedIn());
    expect((result as any).isError).toBe(true);
    expect(errorOf(result).code).toBe('not_signed_in');
    expect(ask).not.toHaveBeenCalled();
  });

  it('passes the verified subject and the arguments, with the reason no_answer when it is left out', async () => {
    const ask = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi, identity } = setup(SUBJECT, { ask });
    const extra = extraWith({ authorization: 'Bearer mcp_at_x' });

    await call(strapi, args, extra);

    expect(identity.getCustomerSubject).toHaveBeenCalledWith(extra);
    expect(ask).toHaveBeenCalledExactlyOnceWith({
      subject: SUBJECT,
      question: args.question,
      reason: 'no_answer',
      productSlug: undefined,
      locale: undefined,
    });
  });

  it('passes the reason, the piece and the language when it is given them', async () => {
    const ask = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi } = setup(SUBJECT, { ask });

    await call(strapi, { ...args, reason: 'asked_for_person', productSlug: 'jewelry-coffret', locale: 'en' });

    expect(ask).toHaveBeenCalledExactlyOnceWith({
      subject: SUBJECT,
      question: args.question,
      reason: 'asked_for_person',
      productSlug: 'jewelry-coffret',
      locale: 'en',
    });
  });

  it('takes the customer only from the session, never from what the arguments say', async () => {
    const ask = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi } = setup(SUBJECT, { ask });
    const somebodyElse = `line:U${'b'.repeat(32)}`;

    await call(strapi, { ...args, subject: somebodyElse, customer: somebodyElse, userId: `U${'b'.repeat(32)}` });

    expect(ask).toHaveBeenCalledOnce();
    expect(Object.keys(ask.mock.calls[0][0]).sort()).toEqual(['locale', 'productSlug', 'question', 'reason', 'subject']);
    expect(JSON.stringify(ask.mock.calls[0][0])).not.toContain('b'.repeat(32));
    expect((ask.mock.calls[0][0] as any).subject).toBe(SUBJECT);
  });

  it('returns the question the service recorded, as { question }', async () => {
    const ask = vi.fn(async () => ({ ok: true, value: view }));
    const { strapi } = setup(SUBJECT, { ask });

    const result: any = await call(strapi);

    expect(result.isError).toBeUndefined();
    expect(handOffToStaffTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({ question: view });
    expect(JSON.parse(result.content[0].text)).toEqual({ question: view });
  });

  it('returns a question with no piece as product null', async () => {
    const ask = vi.fn(async () => ({ ok: true, value: { reference: 'Q-4821', status: 'open', product: null } }));
    const { strapi } = setup(SUBJECT, { ask });

    const result: any = await call(strapi);

    expect(handOffToStaffTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({
      question: { reference: 'Q-4821', status: 'open', product: null },
    });
  });

  it('turns a service failure into a tool error with the same code, message and hint', async () => {
    const failure = {
      ok: false,
      code: 'too_many_open_questions',
      message: "This customer already has 5 questions with Maison's client advisors.",
      hint: "Don't hand this one off.",
    };
    const ask = vi.fn(async () => failure);
    const { strapi } = setup(SUBJECT, { ask });

    const result: any = await call(strapi);

    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual({ code: failure.code, message: failure.message, hint: failure.hint });
    expect(result.structuredContent).toBeUndefined();
  });

  it('validates with the shared schema object, whose locale is the same one every customer tool takes', () => {
    expect(handOffToStaffTool.resolveInputSchema!(context)).toBe(handOffToStaffInput);
    expect(handOffToStaffInput.shape.locale).toBe(localeInput);
  });

  it('answers only an open question, with the piece or none', () => {
    const output = handOffToStaffTool.resolveOutputSchema(context);
    expect(output.safeParse({ question: view }).success).toBe(true);
    expect(output.safeParse({ question: { ...view, status: 'taken' } }).success).toBe(false);
    expect(output.safeParse({ question: { reference: 'Q-4821', status: 'open' } }).success).toBe(false);
  });
});
