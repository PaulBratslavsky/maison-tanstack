import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UID } from '../../server/src/constants';
import confirmations from '../../server/src/services/confirmations';
import { LIFF_URL, LINE_API, LINE_CONFIG as CONFIG, LINE_USER_ID, PUBLISHED, TOKEN, lineAnswers, world } from './fake-line';

type Doc = Record<string, any>;

const NOW = new Date('2026-10-01T00:00:00Z');

let fetchMock: ReturnType<typeof lineAnswers>;
const useFetch = (mock: ReturnType<typeof lineAnswers>) => {
  fetchMock = mock;
  vi.stubGlobal('fetch', mock);
};
const pushed = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, init: init as RequestInit, body: JSON.parse(String((init as RequestInit).body)) };
};

beforeEach(() => useFetch(lineAnswers()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendConfirmation', () => {
  it("pushes the visit's flex message to LINE once and records it as sent, by strapi", async () => {
    const { sender, record } = world();
    const outcome = await sender.sendConfirmation('APT-4821');

    expect(outcome).toMatchObject({ reference: 'APT-4821', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const { url, init, body } = pushed();
    expect(url).toBe(`${LINE_API}/v2/bot/message/push`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ type: 'flex', altText: 'ご来店予約が確定しました（APT-4821）', contents: { type: 'bubble' } });
    expect(JSON.stringify(body.messages[0].contents)).toContain(`${LIFF_URL}/visits/APT-4821`);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      reference: 'APT-4821',
      status: 'sent',
      detail: '{"sentMessages":[{"id":"1","quoteToken":"q"}]}',
      recordedBy: 'strapi',
    });
  });

  it('sends to the LINE user ID: the customer without its line: prefix', async () => {
    await world().sender.sendConfirmation('APT-4821');
    expect(pushed().body.to).toBe(LINE_USER_ID);
  });

  it('sends nothing, and records nothing, once a confirmation has been sent', async () => {
    const { sender, record } = world({ sent: true });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'already_sent' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('sends once when it is asked twice', async () => {
    const { sender } = world();
    await sender.sendConfirmation('APT-4821');
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'already_sent' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends once when it is asked twice at the same time, and both callers get that outcome', async () => {
    const { sender, record } = world();
    const [first, second] = await Promise.all([sender.sendConfirmation('APT-4821'), sender.sendConfirmation('APT-4821')]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(first.status).toBe('sent');
    expect(second).toBe(first);
  });

  it('lets the next call send when a send ended in an error', async () => {
    const w = world();
    const documents = w.strapi.documents;
    let failNext = true;
    w.strapi.documents = Object.assign(
      (uid: string) =>
        uid === UID.notification && failNext
          ? {
              findFirst: async () => {
                failNext = false;
                throw new Error('database is down');
              },
            }
          : documents(uid),
      { use: documents.use }
    );
    await expect(w.sender.sendConfirmation('APT-4821')).rejects.toThrow('database is down');
    expect(await w.sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'sent' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['answers not ok', async () => ({ ok: false, code: 'not_published', message: 'Not confirmed.', hint: 'None.' })],
    ['throws', async () => Promise.reject(new Error('database is down'))],
  ])('answers sent_unrecorded, logged as an error, when LINE took the message but recording it %s', async (_label, record) => {
    const w = world();
    w.services.confirmations = { record: vi.fn(record) };
    const outcome = await w.sender.sendConfirmation('APT-4821');
    expect(outcome.status).toBe('sent_unrecorded');
    expect(outcome.message).toMatch(/Sent the LINE confirmation for APT-4821, but recording it failed/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(w.strapi.log.error).toHaveBeenCalledOnce();
    expect(w.strapi.log.info).not.toHaveBeenCalled();
  });

  it('answers failed, and never throws, when LINE refused the push and recording that threw', async () => {
    useFetch(lineAnswers(400, { message: 'Bad request' }));
    const w = world();
    w.services.confirmations = { record: vi.fn(async () => Promise.reject(new Error('database is down'))) };
    expect((await w.sender.sendConfirmation('APT-4821')).status).toBe('failed');
    expect(w.strapi.log.error).toHaveBeenCalledOnce();
  });

  it("records failed, with LINE's HTTP status and message, when LINE refuses the push", async () => {
    useFetch(lineAnswers(400, { message: "The property, 'to', in the request body is invalid (line 1, column 6)" }));
    const { sender, record } = world();
    const outcome = await sender.sendConfirmation('APT-4821');
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain("LINE answered 400: The property, 'to', in the request body is invalid (line 1, column 6)");
    expect(record).toHaveBeenCalledExactlyOnceWith({
      reference: 'APT-4821',
      status: 'failed',
      detail: "LINE answered 400: The property, 'to', in the request body is invalid (line 1, column 6)",
      recordedBy: 'strapi',
    });
  });

  it("records failed when LINE can't be reached", async () => {
    useFetch(vi.fn(async () => Promise.reject(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:4010') }))));
    const { sender, record } = world();
    expect((await sender.sendConfirmation('APT-4821')).status).toBe('failed');
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'failed', detail: "LINE couldn't be reached: connect ECONNREFUSED 127.0.0.1:4010", recordedBy: 'strapi' })
    );
  });

  it("gives LINE 8 seconds, and records failed when it doesn't answer in time", async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    useFetch(vi.fn(async () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))));
    const { sender, record } = world();
    expect((await sender.sendConfirmation('APT-4821')).status).toBe('failed');
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(pushed().init.signal).toBe(timeout.mock.results[0].value);
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'failed', detail: "LINE didn't answer within 8 seconds." })
    );
  });

  it('without a token, sends and records nothing, and says so once per process', async () => {
    const { sender, record, strapi } = world({ config: { ...CONFIG, lineChannelAccessToken: null } });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'not_configured' });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(strapi.log.warn).toHaveBeenCalledOnce();
    expect(strapi.log.warn.mock.calls[0][0]).toMatch(/LINE_CHANNEL_ACCESS_TOKEN isn't set: confirmations aren't sent from Strapi/);
  });

  it('without a liffUrl, sends and records nothing, as pending_confirmations refuses to list one', async () => {
    const { sender, record } = world({ config: { ...CONFIG, liffUrl: null } });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'not_configured', message: expect.stringMatching(/liffUrl/) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('sends nothing for a visit that has no published version: not_confirmed', async () => {
    const { sender, record } = world({ published: null });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'not_confirmed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('sends and records nothing for a visit that is over: past, as pending_confirmations lists none', async () => {
    const { sender, record } = world();
    const outcome = await sender.sendConfirmation('APT-4821', new Date('2030-01-12T05:00:00.001Z'));
    expect(outcome).toMatchObject({ status: 'past', message: expect.stringContaining('2030-01-12T14:00:00+09:00') });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('still sends at the moment the visit starts, when pending_confirmations still lists it', async () => {
    const { sender } = world();
    expect(await sender.sendConfirmation('APT-4821', new Date('2030-01-12T05:00:00.000Z'))).toMatchObject({ status: 'sent' });
  });

  it('answers not_found for a reference no appointment has', async () => {
    const { sender, record } = world({ exists: false });
    expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('records failed, without a push, for a visit with no LINE customer', async () => {
    const { sender, record } = world({ published: { ...PUBLISHED, customer: 'someone@example.test' } });
    expect((await sender.sendConfirmation('APT-4821')).status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'failed', recordedBy: 'strapi' }));
  });

  it('never records or logs the token, even when an error quotes it', async () => {
    // undici quotes a header value it refuses, Authorization included.
    useFetch(vi.fn(async () => Promise.reject(new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`))));
    const { sender, record, strapi } = world();
    const outcome = await sender.sendConfirmation('APT-4821');
    const written = JSON.stringify([outcome, record.mock.calls, strapi.log.warn.mock.calls, strapi.log.info.mock.calls, strapi.log.error.mock.calls]);
    expect(outcome.status).toBe('failed');
    expect(written).not.toContain(TOKEN);
  });
});

describe("a made-up demo customer's visit", () => {
  const DEMO = { ...PUBLISHED, customer: 'line:Udec0de00000000000000000000000002' };

  it('makes no LINE call, and records a demo outcome by strapi, with the plain detail', async () => {
    const { sender, record } = world({ published: DEMO });
    const outcome = await sender.sendConfirmation('APT-4821');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({ reference: 'APT-4821', status: 'demo', message: 'Demo customer: no LINE confirmation for APT-4821.' });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      reference: 'APT-4821',
      status: 'demo',
      detail: 'Demo customer: no LINE message',
      recordedBy: 'strapi',
    });
  });

  it('records it without a token or a liffUrl too: no LINE message was ever going to go', async () => {
    const { sender, record } = world({ published: DEMO, config: {} });
    expect((await sender.sendConfirmation('APT-4821')).status).toBe('demo');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
  });

  it('logs it as info, never as a warning or an error', async () => {
    const { sender, strapi } = world({ published: DEMO });
    await sender.sendConfirmation('APT-4821');
    expect(strapi.log.warn).not.toHaveBeenCalled();
    expect(strapi.log.error).not.toHaveBeenCalled();
    expect(strapi.log.info).toHaveBeenCalledWith('[maison] Demo customer: no LINE confirmation for APT-4821.');
  });

  it('still answers demo, and logs why, when recording it fails', async () => {
    const { sender, record, strapi } = world({ published: DEMO });
    record.mockRejectedValueOnce(new Error('database is locked'));
    expect((await sender.sendConfirmation('APT-4821')).status).toBe('demo');
    expect(strapi.log.error).toHaveBeenCalledWith(expect.stringContaining('database is locked'));
  });

  it('records nothing for a visit that is over: past, as for anyone', async () => {
    const { sender, record } = world({ published: { ...DEMO, requestedFor: '2026-09-30T05:00:00.000Z' } });
    expect((await sender.sendConfirmation('APT-4821', NOW)).status).toBe('past');
    expect(record).not.toHaveBeenCalled();
  });

  it('is not pending: pending_confirmations never lists it', async () => {
    const { strapi } = world({ published: DEMO });
    expect(await confirmations({ strapi }).listPending(10, NOW)).toEqual({ ok: true, value: [] });
  });
});

describe('pending_confirmations and the demo outcome', () => {
  it("leaves out a visit with a demo record, and counts only failed records as earlier attempts", async () => {
    const findMany = vi.fn(async ({ filters }: Doc) => {
      if (filters?.outcome) {
        // The query for the visits with nothing left to send: it must ask for demo records as well as sent ones.
        expect(filters.outcome).toEqual({ $in: ['sent', 'demo'] });
        return [];
      }
      return [
        { appointmentReference: 'APT-4821', outcome: 'failed' },
        { appointmentReference: 'APT-4821', outcome: 'failed' },
      ];
    });
    const w = world();
    const documents = w.strapi.documents;
    w.strapi.documents = Object.assign((uid: string) => (uid === UID.notification ? { findMany } : documents(uid)), { use: documents.use });
    const listed = await confirmations({ strapi: w.strapi }).listPending(10, NOW);
    expect(listed.ok).toBe(true);
    expect((listed as { value: Doc[] }).value.map((row) => [row.reference, row.previousAttempts])).toEqual([['APT-4821', 2]]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ filters: { outcome: { $in: ['sent', 'demo'] } } }));
  });
});

describe('the confirmation message', () => {
  it("is the one pending_confirmations lists for the same appointment, for the same customer", async () => {
    const { strapi, sender, appointmentFindOne, appointmentFindMany } = world();
    const listed = await confirmations({ strapi }).listPending(10, NOW);
    expect(listed.ok).toBe(true);
    const [pending] = (listed as { value: Doc[] }).value;

    await sender.sendConfirmation('APT-4821');
    const { body } = pushed();
    expect(body.to).toBe(pending.lineUserId);
    expect(body.messages).toEqual([{ type: 'flex', ...pending.message }]);
    // Both read the same fields of the published visit.
    expect(appointmentFindOne.mock.calls[0][0].populate).toEqual(appointmentFindMany.mock.calls[0][0].populate);
  });
});

describe('over real HTTP, with the real fetch', () => {
  /** A server on a free port of this machine that answers every request as LINE answers a push, and keeps them. */
  const startServer = async () => {
    const received: Array<{ method?: string; url?: string; headers: IncomingHttpHeaders; body: Doc }> = [];
    const server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        received.push({ method: request.method, url: request.url, headers: request.headers, body: JSON.parse(raw) });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"sentMessages":[{"id":"7","quoteToken":"t"}]}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { url, received, close: () => new Promise((resolve) => server.close(resolve)) };
  };

  beforeEach(() => vi.unstubAllGlobals());

  it('sends the push LINE expects to the configured API', async () => {
    const server = await startServer();
    try {
      const { sender, record } = world({ config: { ...CONFIG, lineApiBaseUrl: server.url } });
      expect(await sender.sendConfirmation('APT-4821')).toMatchObject({ status: 'sent' });
      expect(server.received).toHaveLength(1);
      const [push] = server.received;
      expect(push).toMatchObject({ method: 'POST', url: '/v2/bot/message/push', body: { to: LINE_USER_ID } });
      expect(push.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(push.headers['content-type']).toBe('application/json');
      expect(push.body.messages[0]).toMatchObject({ type: 'flex', altText: 'ご来店予約が確定しました（APT-4821）' });
      expect(record).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'sent', detail: '{"sentMessages":[{"id":"7","quoteToken":"t"}]}' })
      );
    } finally {
      await server.close();
    }
  });

  it('records failed, with the reason, when nothing listens there', async () => {
    const server = await startServer();
    await server.close(); // the port is free again, so the connection is refused
    const { sender, record } = world({ config: { ...CONFIG, lineApiBaseUrl: server.url } });
    expect((await sender.sendConfirmation('APT-4821')).status).toBe('failed');
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'failed', detail: expect.stringMatching(/^LINE couldn't be reached: .*ECONNREFUSED/) })
    );
  });
});
