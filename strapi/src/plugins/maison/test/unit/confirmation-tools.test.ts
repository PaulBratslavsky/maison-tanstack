import { describe, expect, it, vi } from 'vitest';
import { buildConfirmationMessage } from '../../server/src/domain/flex-message';
import { sendPendingConfirmationsPrompt } from '../../server/src/mcp/prompts/send-pending-confirmations';
import { pendingConfirmationsTool } from '../../server/src/mcp/tools/pending-confirmations';
import { recordConfirmationTool } from '../../server/src/mcp/tools/record-confirmation';
import { fakeStrapi } from './fake-strapi';

const context = { userAbility: {} as any, user: { id: 1 } };
const errorOf = (result: any) => JSON.parse(result.content[0].text).error;
const withConfirmations = (confirmations: Record<string, unknown>) => fakeStrapi({ services: { confirmations } });

const appLink = 'https://liff.line.me/1234567890-AbCdEfGh/visits/APT-4821';
const pending = {
  reference: 'APT-4821',
  lineUserId: `U${'a'.repeat(32)}`,
  boutique: { name: '銀座本店', address: '東京都中央区銀座 1-2-3（デモ）' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  requestedForText: '10月10日(土) 14:00',
  products: [{ name: 'ウィークエンダー 50' }],
  previousAttempts: 0,
  appLink,
  message: buildConfirmationMessage({
    houseName: 'メゾン', reference: 'APT-4821', boutiqueName: '銀座本店', boutiqueAddress: '東京都中央区銀座 1-2-3（デモ）',
    requestedForText: '10月10日(土) 14:00', productNames: ['ウィークエンダー 50'], appLink,
  }),
};

describe('pending_confirmations', () => {
  it('defaults the limit to 10 and returns schema-valid output', async () => {
    const listPending = vi.fn(async () => ({ ok: true, value: [pending] }));
    const result = await pendingConfirmationsTool.createHandler(withConfirmations({ listPending }), context)({ args: {}, extra: {} });
    expect(listPending).toHaveBeenCalledWith(10);
    expect(pendingConfirmationsTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({ appointments: [pending] });
  });

  it('reports not_configured when the plugin has no liffUrl', async () => {
    const listPending = vi.fn(async () => ({ ok: false, code: 'not_configured', message: 'No liffUrl.', hint: 'Set liffUrl.' }));
    const result = await pendingConfirmationsTool.createHandler(withConfirmations({ listPending }), context)({ args: { limit: 3 }, extra: {} });
    expect(listPending).toHaveBeenCalledWith(3);
    expect(errorOf(result).code).toBe('not_configured');
  });
});

describe('record_confirmation', () => {
  const notification = { reference: 'APT-4821', status: 'sent', sentAt: '2026-10-07T09:10:00.000Z', detail: '{"sentMessages":[{"id":"1"}]}' };

  it('passes the outcome through and returns schema-valid output', async () => {
    const record = vi.fn(async () => ({ ok: true, value: { notification, alreadyRecorded: false } }));
    const args = { reference: 'APT-4821', status: 'sent', detail: notification.detail };
    const result = await recordConfirmationTool.createHandler(withConfirmations({ record }), context)({ args, extra: {} });
    expect(record).toHaveBeenCalledWith(args);
    expect(recordConfirmationTool.resolveOutputSchema(context).parse(result.structuredContent)).toEqual({ notification, alreadyRecorded: false });
  });

  it('turns not_published into a tool error', async () => {
    const record = vi.fn(async () => ({ ok: false, code: 'not_published', message: 'Not confirmed.', hint: 'Do not message the customer.' }));
    const result = await recordConfirmationTool.createHandler(withConfirmations({ record }), context)({
      args: { reference: 'APT-4821', status: 'sent', detail: 'x' }, extra: {},
    });
    expect(errorOf(result)).toEqual({ code: 'not_published', message: 'Not confirmed.', hint: 'Do not message the customer.' });
  });

  it('validates the reference and status', () => {
    const input = recordConfirmationTool.resolveInputSchema!(context);
    expect(input.safeParse({ reference: 'APT-4821', status: 'failed', detail: 'not reachable' }).success).toBe(true);
    expect(input.safeParse({ reference: '4821', status: 'sent', detail: 'x' }).success).toBe(false);
    expect(input.safeParse({ reference: 'APT-4821', status: 'delivered', detail: 'x' }).success).toBe(false);
    expect(input.safeParse({ reference: 'APT-4821', status: 'sent', detail: '' }).success).toBe(false);
  });
});

describe('send_pending_confirmations prompt', () => {
  const promptText = async (): Promise<string> => {
    const result = await (sendPendingConfirmationsPrompt.createHandler(fakeStrapi()) as any)({});
    return result.messages[0].content.text;
  };
  /** The numbered steps. The intro also names every tool, so it says nothing about the order the agent acts in. */
  const stepsOf = (text: string) => {
    const start = text.indexOf('1. Call');
    expect(start, 'the prompt has numbered steps').toBeGreaterThan(-1);
    return text.slice(start);
  };

  it('is gated on confirmations.send and walks the agent through check, push and record in order', async () => {
    expect(sendPendingConfirmationsPrompt.auth.policies).toEqual([{ action: 'plugin::maison.confirmations.send' }]);
    const text = await promptText();
    const steps = stepsOf(text);
    // Step 2b records a failure before any push, so the last probe is the "sent" recording, which must follow the push.
    const order = ['pending_confirmations', 'get_profile', 'push_flex_message', 'record_confirmation with status "sent"'].map((phrase) => steps.indexOf(phrase));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toMatch(/200/);
    expect(text).toMatch(/not reachable: not a friend or blocked/);
  });

  it('passes userId explicitly to both LINE calls', async () => {
    const text = await promptText();
    const steps = stepsOf(text);
    expect(steps).toMatch(/get_profile with userId set to (its )?lineUserId/);
    expect(steps).toMatch(/push_flex_message with userId set to (its )?lineUserId/);
    expect(steps.match(/userId set to (its )?lineUserId/g)).toHaveLength(2);
    expect(text).toMatch(/Always pass userId explicitly/);
  });

  it('keeps get_profile output out of detail and says what to do when recording goes wrong', async () => {
    const steps = stepsOf(await promptText());
    expect(steps).toMatch(/push_flex_message's response as detail/);
    expect(steps).toMatch(/Never put get_profile output in detail/);
    expect(steps).toMatch(/If recording "sent" fails, retry it/);
    expect(steps).toMatch(/never push that appointment again/);
    expect(steps).toMatch(/alreadyRecorded true[^.]*possible duplicate/);
  });
});
