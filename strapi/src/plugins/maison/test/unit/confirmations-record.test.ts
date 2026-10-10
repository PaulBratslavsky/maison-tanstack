import { describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import { recordConfirmationTool } from '../../server/src/mcp/tools/record-confirmation';
import confirmations from '../../server/src/services/confirmations';
import { fakeStrapi } from './fake-strapi';

/** A published appointment APT-4821 with no notification yet, as record() reads them. `create` keeps what it wrote. */
const setup = () => {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ documentId: 'n-1', ...data }));
  const documents = (uid: string) => {
    if (uid === UID.appointment) {
      return { findFirst: vi.fn(async () => ({ documentId: 'doc-1', reference: 'APT-4821' })), count: vi.fn(async () => 1) };
    }
    return {
      findFirst: vi.fn(async () => null), // no `sent` notification yet
      create,
      findOne: vi.fn(async () => ({ documentId: 'n-1', ...create.mock.calls.at(-1)![0].data })),
    };
  };
  return { service: confirmations({ strapi: fakeStrapi({ documents }) }), create };
};

describe('confirmations.record: who recorded the outcome', () => {
  it('writes the recorder the caller names, such as strapi for a confirmation Strapi sent', async () => {
    const { service, create } = setup();
    const result = await service.record({ reference: 'APT-4821', status: 'sent', detail: '{"sentMessages":[]}', recordedBy: 'strapi' });
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data).toMatchObject({ appointmentReference: 'APT-4821', outcome: 'sent', recordedBy: 'strapi' });
  });

  it('writes ops-agent when the caller names none, as record_confirmation does', async () => {
    const { service, create } = setup();
    await service.record({ reference: 'APT-4821', status: 'failed', detail: 'not reachable: not a friend or blocked' });
    expect(create.mock.calls[0][0].data).toMatchObject({ outcome: 'failed', recordedBy: 'ops-agent' });
  });

  it("can't be named through record_confirmation, whose input drops it", () => {
    const input = recordConfirmationTool.resolveInputSchema!({ userAbility: {} as any, user: { id: 1 } });
    const args = input.parse({ reference: 'APT-4821', status: 'sent', detail: 'ok', recordedBy: 'strapi' });
    expect(args).toEqual({ reference: 'APT-4821', status: 'sent', detail: 'ok' });
  });
});
