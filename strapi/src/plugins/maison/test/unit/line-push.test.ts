import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  USAGE_TIMEOUT_MS,
  getDisplayName,
  getMonthlyUsage,
  pushMessages,
  type LineApi,
  type LineMessage,
} from '../../server/src/domain/line-push';

const API: LineApi = { apiBaseUrl: 'http://127.0.0.1:4010', token: 'tok' };
const CUSTOMER = `U${'a'.repeat(32)}`;
const HI: LineMessage[] = [{ type: 'text', text: 'Hi' }];

/** `fetch` as LINE answers it: `status`, with `body` as the text it sends. */
const answers = (status = 200, body = '') => vi.fn(async (_url: string, _init: RequestInit) => new Response(body, { status }));
/** `fetch` when no answer comes: it rejects with `error`. */
const rejects = (error: unknown) => vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => Promise.reject(error));
/** `fetch` when LINE answers `status` and then the connection breaks: reading the body of the Response fails. */
const answersThenBreaks = (status: number) =>
  vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('terminated')) }), { status })
  );

let fetchMock: ReturnType<typeof answers>;
const useFetch = (mock: ReturnType<typeof answers>) => {
  fetchMock = mock;
  vi.stubGlobal('fetch', mock);
};
/** What `fetch` was asked: where, and how. */
const requested = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, init };
};

// Nothing here reaches LINE: every test starts with fetch stubbed, and the API address is this machine's.
beforeEach(() => useFetch(answers()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pushMessages', () => {
  it("posts the messages to LINE's push endpoint with the token, and answers sent with LINE's body", async () => {
    useFetch(answers(200, '{"sentMessages":[{"id":"1","quoteToken":"q"}]}'));

    expect(await pushMessages(API, CUSTOMER, [{ type: 'text', text: 'Hi' }])).toEqual({
      status: 'sent',
      detail: '{"sentMessages":[{"id":"1","quoteToken":"q"}]}',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const { url, init } = requested();
    expect(url).toBe('http://127.0.0.1:4010/v2/bot/message/push');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ to: CUSTOMER, messages: [{ type: 'text', text: 'Hi' }] });
  });

  it('sends a flex message as it is given, ahead of the text that follows it', async () => {
    const flex: LineMessage = { type: 'flex', altText: 'Your visit is confirmed', contents: { type: 'bubble', body: { type: 'box' } } };
    await pushMessages(API, CUSTOMER, [flex, ...HI]);
    expect(JSON.parse(String(requested().init.body)).messages).toEqual([flex, ...HI]);
  });

  it("answers sent with LINE's status when it took the push and said nothing", async () => {
    useFetch(answers(200));
    expect(await pushMessages(API, CUSTOMER, HI)).toEqual({ status: 'sent', detail: 'LINE answered 200.' });
  });

  it("answers failed, with LINE's status and message, when LINE refuses the push", async () => {
    useFetch(answers(400, '{"message":"The request body has 1 error(s)"}'));
    expect(await pushMessages(API, CUSTOMER, HI)).toEqual({ status: 'failed', detail: 'LINE answered 400: The request body has 1 error(s)' });
  });

  it.each([
    ['no body', ''],
    ['a body that is not JSON', '<html>Bad Gateway</html>'],
    ['a body without a message', '{"details":[]}'],
    ['a message that is not text', '{"message":42}'],
  ])("answers failed, with LINE's status alone, when its refusal has %s", async (_label, body) => {
    useFetch(answers(500, body));
    expect(await pushMessages(API, CUSTOMER, HI)).toEqual({ status: 'failed', detail: 'LINE answered 500.' });
  });

  // LINE's status is all there is to go on when its body can't be read, so it is all the detail says.
  it.each([
    ['sent, for a 200, which is LINE taking the push', 200, { status: 'sent', detail: 'LINE answered 200.' }],
    ['failed, for a 500, which is LINE refusing it', 500, { status: 'failed', detail: 'LINE answered 500.' }],
  ])('answers %s, with its status alone, when the body of the answer cannot be read', async (_label, status, answer) => {
    useFetch(answersThenBreaks(status));
    expect(await pushMessages(API, CUSTOMER, HI)).toEqual(answer);
  });

  it("gives LINE 8 seconds, and answers failed when it doesn't answer in time", async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    useFetch(rejects(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));

    expect(await pushMessages(API, CUSTOMER, HI)).toEqual({ status: 'failed', detail: "LINE didn't answer within 8 seconds." });

    expect(PUSH_TIMEOUT_MS).toBe(8000);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(8000);
    expect(requested().init.signal).toBe(timeout.mock.results[0].value);
  });

  it.each([
    [
      'fetch failed, and says why in its cause',
      Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:4010') }),
      "LINE couldn't be reached: connect ECONNREFUSED 127.0.0.1:4010",
    ],
    ['an error without a cause', new TypeError('Invalid URL'), "LINE couldn't be reached: Invalid URL"],
    ['something that is not an error', 'boom', "LINE couldn't be reached: boom"],
  ])("answers failed, with the reason, when LINE can't be reached: %s", async (_label, error, detail) => {
    useFetch(rejects(error));
    expect(await pushMessages(API, CUSTOMER, HI)).toEqual({ status: 'failed', detail });
  });
});

describe('getDisplayName', () => {
  it("asks LINE's Get profile API for the customer with the token, and answers the display name, trimmed", async () => {
    useFetch(answers(200, '{"displayName":"  Paul "}'));

    expect(await getDisplayName(API, 'Uabc')).toBe('Paul');

    expect(fetchMock).toHaveBeenCalledOnce();
    const { url, init } = requested();
    expect(url).toBe('http://127.0.0.1:4010/v2/bot/profile/Uabc');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
  });

  it('collapses the whitespace inside the name to single spaces, as well as trimming it', async () => {
    useFetch(answers(200, JSON.stringify({ displayName: '  Paul\n  (test)\t ' })));
    expect(await getDisplayName(API, 'Uabc')).toBe('Paul (test)');
  });

  it('keeps the user ID inside the path it asks for', async () => {
    useFetch(answers(200, '{"displayName":"Paul"}'));
    await getDisplayName(API, 'U/../x?y#z');
    expect(requested().url).toBe('http://127.0.0.1:4010/v2/bot/profile/U%2F..%2Fx%3Fy%23z');
  });

  it.each([
    ['a 404, as for someone who is not a friend and has not written to the account', 404, '{"message":"Not found"}'],
    ['a refusal of the token', 401, '{"message":"Authentication failed"}'],
    ['a refusal, whatever name its body carries', 403, '{"displayName":"Paul"}'],
    ['a body that is not JSON', 200, 'nope'],
    ['a body that is null', 200, 'null'],
    ['a body without a displayName', 200, '{"userId":"Uabc"}'],
    ['a displayName that is not text', 200, '{"displayName":42}'],
    ['an empty displayName', 200, '{"displayName":""}'],
    ['a displayName of spaces only', 200, '{"displayName":"   "}'],
  ])('answers null for %s', async (_label, status, body) => {
    useFetch(answers(status, body));
    expect(await getDisplayName(API, 'Uabc')).toBeNull();
  });

  it.each([
    ['fetch rejects', new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:4010') })],
    ["LINE doesn't answer in time", new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
  ])('answers null, and never throws, when %s', async (_label, error) => {
    useFetch(rejects(error));
    expect(await getDisplayName(API, 'Uabc')).toBeNull();
  });

  it('gives LINE 3 seconds for the name', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    useFetch(answers(200, '{"displayName":"Paul"}'));

    await getDisplayName(API, 'Uabc');

    expect(PROFILE_TIMEOUT_MS).toBe(3000);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(3000);
    expect(requested().init.signal).toBe(timeout.mock.results[0].value);
  });

  // The question's customerName holds 100 UTF-16 units (Strapi's maxLength counts them, so 100 emoji don't fit).
  it.each([
    ['a name of 150 letters to 99 and an ellipsis, 100 units', 'n'.repeat(150), `${'n'.repeat(99)}…`],
    ['a name of 150 emoji to 49 and an ellipsis, 99 units, none cut in half', '😀'.repeat(150), `${'😀'.repeat(49)}…`],
  ])('cuts %s', async (_label, name, cut) => {
    useFetch(answers(200, JSON.stringify({ displayName: name })));
    const displayName = await getDisplayName(API, 'Uabc');
    expect(displayName).toBe(cut);
    expect(displayName?.length).toBeLessThanOrEqual(100);
  });
});

describe('getMonthlyUsage', () => {
  const CONSUMPTION_URL = 'http://127.0.0.1:4010/v2/bot/message/quota/consumption';
  const QUOTA_URL = 'http://127.0.0.1:4010/v2/bot/message/quota';
  const NO_USAGE = { used: null, limit: null };

  /** LINE's answer to one request: `status`, with `body` as JSON, or as the text it is when it is a string. */
  const lineSays = (body: unknown, status = 200) => () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  /** `fetch` as LINE answers the two endpoints, each as the function for it says. Anything else it is asked is a mistake. */
  const usageAnswers = (consumption: () => Response | Promise<Response>, quota: () => Response | Promise<Response>) =>
    vi.fn(async (url: string, _init: RequestInit) => {
      if (url === CONSUMPTION_URL) return consumption();
      if (url === QUOTA_URL) return quota();
      throw new Error(`The stand-in has no route ${url}`);
    });

  it("asks LINE for this month's total and for the limit, with the token, and answers both", async () => {
    useFetch(usageAnswers(lineSays({ totalUsage: 12 }), lineSays({ type: 'limited', value: 200 })));

    expect(await getMonthlyUsage(API)).toEqual({ used: 12, limit: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([QUOTA_URL, CONSUMPTION_URL].sort());
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
      expect(init.body).toBeUndefined();
    }
  });

  it('answers no limit when LINE says the channel has none', async () => {
    useFetch(usageAnswers(lineSays({ totalUsage: 12 }), lineSays({ type: 'none' })));
    expect(await getMonthlyUsage(API)).toEqual({ used: 12, limit: null });
  });

  it('answers a total of 0 as 0, not as nothing', async () => {
    useFetch(usageAnswers(lineSays({ totalUsage: 0 }), lineSays({ type: 'limited', value: 0 })));
    expect(await getMonthlyUsage(API)).toEqual({ used: 0, limit: 0 });
  });

  it('reads the limit only when the type is limited: a value beside none is ignored', async () => {
    useFetch(usageAnswers(lineSays({ totalUsage: 5 }), lineSays({ type: 'none', value: 200 })));
    expect(await getMonthlyUsage(API)).toEqual({ used: 5, limit: null });
  });

  // No limit and no answer are different things to staff: a limit of null means there is none. So when either call goes
  // wrong, both are null, and the page shows nothing rather than a total that looks like a channel with no limit.
  it.each([
    ['refuses the total', lineSays({ message: 'Authentication failed' }, 401), lineSays({ type: 'limited', value: 200 })],
    ['refuses the limit', lineSays({ totalUsage: 12 }), lineSays({ message: 'Authentication failed' }, 401)],
    // A refusal says nothing about usage, whatever its body looks like.
    ['refuses the total, with a total in its body', lineSays({ totalUsage: 12 }, 429), lineSays({ type: 'limited', value: 200 })],
    ['refuses the limit, with a limit in its body', lineSays({ totalUsage: 12 }), lineSays({ type: 'limited', value: 200 }, 403)],
    ['has an error of its own for the total', lineSays('<html>Bad Gateway</html>', 502), lineSays({ type: 'limited', value: 200 })],
    ['has an error of its own for the limit', lineSays({ totalUsage: 12 }), lineSays('', 500)],
    ['answers the total with something that is not JSON', lineSays('nope'), lineSays({ type: 'limited', value: 200 })],
    ['answers the limit with something that is not JSON', lineSays({ totalUsage: 12 }), lineSays('nope')],
    ['answers the total with an empty body', lineSays(''), lineSays({ type: 'limited', value: 200 })],
    ['answers the total with null', lineSays('null'), lineSays({ type: 'limited', value: 200 })],
    ['answers the limit with null', lineSays({ totalUsage: 12 }), lineSays('null')],
    ['answers a total that has no totalUsage', lineSays({ total: 12 }), lineSays({ type: 'limited', value: 200 })],
    ['answers a totalUsage that is text', lineSays({ totalUsage: '12' }), lineSays({ type: 'limited', value: 200 })],
    ['answers a totalUsage below 0', lineSays({ totalUsage: -1 }), lineSays({ type: 'limited', value: 200 })],
    ['answers a totalUsage that is not a whole number', lineSays({ totalUsage: 1.5 }), lineSays({ type: 'limited', value: 200 })],
    ['answers a limit of a type it does not know', lineSays({ totalUsage: 12 }), lineSays({ type: 'unlimited' })],
    ['answers a limited channel with no value', lineSays({ totalUsage: 12 }), lineSays({ type: 'limited' })],
    ['answers a limited channel with a value that is text', lineSays({ totalUsage: 12 }), lineSays({ type: 'limited', value: '200' })],
    ['answers a limited channel with a value below 0', lineSays({ totalUsage: 12 }), lineSays({ type: 'limited', value: -5 })],
    ['answers a limit with no type', lineSays({ totalUsage: 12 }), lineSays({ value: 200 })],
  ])('answers no total and no limit when LINE %s', async (_label, consumption, quota) => {
    useFetch(usageAnswers(consumption, quota));
    expect(await getMonthlyUsage(API)).toEqual(NO_USAGE);
  });

  it.each([
    ['fetch rejects for both', rejects(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:4010') }))],
    ["LINE doesn't answer in time", rejects(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))],
    [
      'fetch rejects for the total only',
      vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
        if (url === CONSUMPTION_URL) throw new TypeError('fetch failed');
        return lineSays({ type: 'limited', value: 200 })();
      }),
    ],
    [
      'fetch rejects for the limit only',
      vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
        if (url === QUOTA_URL) throw new TypeError('fetch failed');
        return lineSays({ totalUsage: 12 })();
      }),
    ],
    ['reading an answer fails halfway', answersThenBreaks(200)],
  ])('answers no total and no limit, and never throws, when %s', async (_label, mock) => {
    useFetch(mock);
    expect(await getMonthlyUsage(API)).toEqual(NO_USAGE);
  });

  it('gives LINE 3 seconds for each answer', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    useFetch(usageAnswers(lineSays({ totalUsage: 12 }), lineSays({ type: 'limited', value: 200 })));

    await getMonthlyUsage(API);

    expect(USAGE_TIMEOUT_MS).toBe(3000);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls).toEqual([[3000], [3000]]);
    // Each request has a signal of its own, made by one of those two calls.
    fetchMock.mock.calls.forEach(([, init], call) => expect(init.signal).toBe(timeout.mock.results[call].value));
    expect(fetchMock.mock.calls[0][1].signal).not.toBe(fetchMock.mock.calls[1][1].signal);
  });

  it('asks for both at once, so a slow LINE costs one wait and not two', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    useFetch(
      vi.fn(async (url: string, _init: RequestInit) => {
        await gate;
        return url === CONSUMPTION_URL ? lineSays({ totalUsage: 12 })() : lineSays({ type: 'limited', value: 200 })();
      })
    );

    const usage = getMonthlyUsage(API);
    // Neither has answered, and both have been asked.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release();

    expect(await usage).toEqual({ used: 12, limit: 200 });
  });
});
