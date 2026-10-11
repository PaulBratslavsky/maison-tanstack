import { describe, expect, it, vi } from 'vitest';
import { CLOSE_REASONS, INQUIRY_FILTERS, INQUIRY_KINDS, SENTIMENT_LABELS } from '../../server/src/constants';
import controllers from '../../server/src/controllers';
import appointmentsController from '../../server/src/controllers/appointments';
import demoController from '../../server/src/controllers/demo';
import inquiriesController from '../../server/src/controllers/inquiries';
import questionsController from '../../server/src/controllers/questions';
import routes from '../../server/src/routes';
import { fakeStrapi } from './fake-strapi';

/** Strapi's error helpers on a Koa context, such as ctx.badRequest, and the status each one sets. */
const ERROR_HELPERS = {
  badRequest: 400,
  notFound: 404,
  conflict: 409,
  unprocessableEntity: 422,
  badGateway: 502,
  serviceUnavailable: 503,
};

/** Enough of a Koa context: each of Strapi's error helpers sets its status and an error body. */
const fakeCtx = (overrides: Record<string, unknown> = {}) => {
  const ctx: any = { query: {}, params: {}, status: 200, body: undefined, ...overrides };
  for (const [helper, status] of Object.entries(ERROR_HELPERS)) {
    ctx[helper] = vi.fn((message: string, details: unknown) => {
      ctx.status = status;
      ctx.body = { error: { message, details } };
    });
  }
  return ctx;
};
/** Nothing in the request went to an error helper. */
const expectNoError = (ctx: any) => {
  for (const helper of Object.keys(ERROR_HELPERS)) expect(ctx[helper], helper).not.toHaveBeenCalled();
};
const controllerWith = (appointments: Record<string, unknown>) =>
  appointmentsController({ strapi: fakeStrapi({ services: { appointments } }) });
/** The appointments controller, with `sendConfirmation` standing in for the line-confirmations service. */
const controllerSending = (sendConfirmation: (reference: string) => Promise<unknown>) =>
  appointmentsController({ strapi: fakeStrapi({ services: { 'line-confirmations': { sendConfirmation } } }) });

describe('admin routes', () => {
  const gate = (action: string) => ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: [action] } }];
  const routeOf = (method: string, path: string) => routes.admin.routes.find((route) => route.method === method && route.path === path);
  const policiesOf = (method: string, path: string) => routeOf(method, path)?.config.policies;

  it('each require a signed-in admin with the matching Maison permission', () => {
    expect(routes.admin.type).toBe('admin');
    expect(routes.admin.routes).toHaveLength(24);
    expect(policiesOf('GET', '/appointments')).toEqual(gate('plugin::maison.appointments.review'));
    expect(policiesOf('GET', '/appointments/summary')).toEqual(gate('plugin::maison.appointments.review'));
    expect(policiesOf('POST', '/appointments/:reference/confirm')).toEqual(gate('plugin::maison.appointments.confirm'));
    // Send again: whoever may confirm a visit may send its confirmation again.
    expect(policiesOf('POST', '/appointments/:reference/notify')).toEqual(gate('plugin::maison.appointments.confirm'));
    expect(policiesOf('GET', '/questions')).toEqual(gate('plugin::maison.questions.read'));
    // Let them know and Answer are one permission: whoever may answer a customer may let them know first.
    expect(policiesOf('POST', '/questions/:reference/notify')).toEqual(gate('plugin::maison.questions.answer'));
    expect(policiesOf('POST', '/questions/:reference/answer')).toEqual(gate('plugin::maison.questions.answer'));
    expect(policiesOf('GET', '/inquiries')).toEqual(gate('plugin::maison.inquiries.view'));
    expect(policiesOf('GET', '/inquiries/summary')).toEqual(gate('plugin::maison.inquiries.view'));
    expect(policiesOf('GET', '/inquiries/quota')).toEqual(gate('plugin::maison.inquiries.view'));
    // Reply, Close, Change label and Label again are one permission: whoever may reply to customers works the queue.
    expect(policiesOf('POST', '/inquiries/:documentId/reply')).toEqual(gate('plugin::maison.inquiries.reply'));
    expect(policiesOf('POST', '/inquiries/:documentId/close')).toEqual(gate('plugin::maison.inquiries.reply'));
    expect(policiesOf('POST', '/inquiries/:documentId/label')).toEqual(gate('plugin::maison.inquiries.reply'));
    expect(policiesOf('POST', '/inquiries/:documentId/label-again')).toEqual(gate('plugin::maison.inquiries.reply'));
    // The Ask tab's two routes, for admins who hold "Use the Maison assistant".
    expect(policiesOf('GET', '/assistant/status')).toEqual(gate('plugin::maison.assistant.use'));
    expect(policiesOf('POST', '/assistant/chat')).toEqual(gate('plugin::maison.assistant.use'));
    // The Ask tab's saved chats: the same permission as the chat. Each admin sees only their own.
    expect(policiesOf('GET', '/conversations')).toEqual(gate('plugin::maison.assistant.use'));
    expect(policiesOf('POST', '/conversations')).toEqual(gate('plugin::maison.assistant.use'));
    expect(policiesOf('GET', '/conversations/:documentId')).toEqual(gate('plugin::maison.assistant.use'));
    expect(policiesOf('PUT', '/conversations/:documentId')).toEqual(gate('plugin::maison.assistant.use'));
    expect(policiesOf('DELETE', '/conversations/:documentId')).toEqual(gate('plugin::maison.assistant.use'));
    expect(policiesOf('POST', '/demo/seed')).toEqual(gate('plugin::maison.demo.manage'));
    expect(policiesOf('POST', '/demo/reset')).toEqual(gate('plugin::maison.demo.manage'));
    expect(policiesOf('POST', '/demo/activity')).toEqual(gate('plugin::maison.demo.manage'));
  });

  it('send Load demo activity to the demo controller', () => {
    expect(routeOf('POST', '/demo/activity')?.handler).toBe('demo.activity');
  });

  it('send the inquiries to the inquiries controller', () => {
    expect(routeOf('GET', '/inquiries')?.handler).toBe('inquiries.list');
    expect(routeOf('GET', '/inquiries/summary')?.handler).toBe('inquiries.summary');
    expect(routeOf('GET', '/inquiries/quota')?.handler).toBe('inquiries.quota');
    expect(routeOf('POST', '/inquiries/:documentId/reply')?.handler).toBe('inquiries.reply');
    expect(routeOf('POST', '/inquiries/:documentId/close')?.handler).toBe('inquiries.close');
    expect(routeOf('POST', '/inquiries/:documentId/label')?.handler).toBe('inquiries.label');
    expect(routeOf('POST', '/inquiries/:documentId/label-again')?.handler).toBe('inquiries.labelAgain');
  });

  it('give every inquiry route but the three reads a :documentId, and the reads none', () => {
    const inquiryRoutes = routes.admin.routes.filter((route) => route.path.startsWith('/inquiries'));
    expect(inquiryRoutes).toHaveLength(7);
    expect(inquiryRoutes.filter((route) => !route.path.includes(':documentId')).map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /inquiries',
      'GET /inquiries/summary',
      'GET /inquiries/quota',
    ]);
  });

  it('send the Ask tab to the assistant controller', () => {
    expect(routeOf('GET', '/assistant/status')?.handler).toBe('assistant.status');
    expect(routeOf('POST', '/assistant/chat')?.handler).toBe('assistant.chat');
  });

  it('send the customer questions to the questions controller', () => {
    expect(routeOf('GET', '/questions')?.handler).toBe('questions.list');
    expect(routeOf('POST', '/questions/:reference/notify')?.handler).toBe('questions.notify');
    expect(routeOf('POST', '/questions/:reference/answer')?.handler).toBe('questions.answer');
  });

  it('name controller actions that exist', () => {
    const instances = Object.fromEntries(
      Object.entries(controllers).map(([name, factory]) => [name, (factory as any)({ strapi: fakeStrapi() })])
    );
    for (const { handler } of routes.admin.routes) {
      const [controller, action] = handler.split('.');
      expect(typeof instances[controller]?.[action], handler).toBe('function');
    }
  });

  it.each(['/appointments/summary', '/inquiries/summary', '/inquiries/quota'])(
    'list %s before any route whose :parameter could take its last word for a value',
    (path) => {
      // The first route that matches a request answers it, so nothing ahead of this one may match its path.
      const paths = routes.admin.routes.filter((route) => route.method === 'GET').map((route) => route.path);
      const at = paths.indexOf(path);
      expect(at, `GET ${path} is registered`).toBeGreaterThanOrEqual(0);
      const matchesPath = (candidate: string) => new RegExp(`^${candidate.replace(/:[^/]+/g, '[^/]+')}$`).test(path);
      expect(paths.slice(0, at).filter(matchesPath)).toEqual([]);
    }
  );

  it('list the inquiries summary and quota ahead of every inquiry route that takes a :documentId, whatever its method', () => {
    const at = (path: string) => routes.admin.routes.findIndex((route) => route.path === path);
    const withId = routes.admin.routes.flatMap((route, index) => (route.path.startsWith('/inquiries') && route.path.includes(':documentId') ? [index] : []));
    expect(withId).toHaveLength(4);
    for (const path of ['/inquiries/summary', '/inquiries/quota']) {
      expect(at(path), path).toBeGreaterThanOrEqual(0);
      for (const index of withId) expect(at(path), `${path} before ${routes.admin.routes[index].path}`).toBeLessThan(index);
    }
  });
});

describe('appointments controller', () => {
  it('lists with the filters from the query string', async () => {
    const listRequests = vi.fn(async () => ({ ok: true, value: [] }));
    const ctx = fakeCtx({ query: { status: 'all', limit: '5' } });
    await controllerWith({ listRequests }).list(ctx);
    expect(listRequests).toHaveBeenCalledWith({ status: 'all', limit: 5 });
    expect(ctx.body).toEqual({ appointments: [] });
  });

  it('answers bad filters with 400 invalid_input and never calls the service', async () => {
    const listRequests = vi.fn();
    for (const query of [{ status: 'pending' }, { limit: '0' }, { limit: 'ten' }, { date: '10/10/2026' }, { date: '2026-09-31' }]) {
      const ctx = fakeCtx({ query });
      await controllerWith({ listRequests }).list(ctx);
      expect(ctx.status, JSON.stringify(query)).toBe(400);
      expect(ctx.body.error.details.code).toBe('invalid_input');
    }
    expect(listRequests).not.toHaveBeenCalled();
  });

  describe('summary', () => {
    const summary = {
      counts: { waitingForStaff: 2, confirmedUpcoming: 1, confirmationsSent: 1 },
      recent: [
        {
          reference: 'APT-4821', status: 'requested', customer: 'line:U4af…88', boutique: null, requestedFor: '2026-10-10T14:00:00+09:00',
          note: 'A gift for a friend who travels', confirmationSent: false, createdAt: '2026-10-01T09:00:00+09:00',
        },
      ],
    };

    it("returns the service's summary", async () => {
      const summarizeRequests = vi.fn(async () => summary);
      const ctx = fakeCtx();
      await controllerWith({ summarizeRequests }).summary(ctx);
      expect(ctx.body).toEqual(summary);
    });

    it('counts at the real time: nothing in the request can move the service clock', async () => {
      const summarizeRequests = vi.fn(async () => summary);
      await controllerWith({ summarizeRequests }).summary(fakeCtx({ query: { now: '2020-01-01T00:00:00Z', limit: '1' } }));
      expect(summarizeRequests).toHaveBeenCalledWith();
    });

    it("lets a service failure reach Strapi's error handling, so the widget shows its error and not made-up numbers", async () => {
      const summarizeRequests = vi.fn(async () => {
        throw new Error('database is down');
      });
      const ctx = fakeCtx();
      await expect(controllerWith({ summarizeRequests }).summary(ctx)).rejects.toThrow('database is down');
      expect(ctx.body).toBeUndefined();
    });
  });

  it('returns the confirmed appointment', async () => {
    const value = { appointment: { reference: 'APT-4821', status: 'confirmed' }, alreadyConfirmed: false };
    const confirm = vi.fn(async () => ({ ok: true, value }));
    const ctx = fakeCtx({ params: { reference: 'APT-4821' } });
    await controllerWith({ confirm }).confirm(ctx);
    expect(confirm).toHaveBeenCalledWith('APT-4821');
    expect(ctx.body).toEqual(value);
  });

  it.each([
    ['not_found', 404],
    ['in_the_past', 400],
  ])('answers %s with %i, the message and the hint', async (code, status) => {
    const confirm = vi.fn(async () => ({ ok: false, code, message: 'Not possible.', hint: 'Try another.' }));
    const ctx = fakeCtx({ params: { reference: 'APT-4821' } });
    await controllerWith({ confirm }).confirm(ctx);
    expect(ctx.status).toBe(status);
    expect(ctx.body.error).toEqual({ message: 'Not possible.', details: { code, hint: 'Try another.' } });
  });

  it('rejects a malformed reference without calling the service', async () => {
    const confirm = vi.fn();
    const ctx = fakeCtx({ params: { reference: 'APT-48' } });
    await controllerWith({ confirm }).confirm(ctx);
    expect(ctx.status).toBe(400);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('Send again (notify)', () => {
  it.each(['sent', 'already_sent', 'sent_unrecorded'])('answers %s with a 200 and the outcome', async (status) => {
    const outcome = { reference: 'APT-4821', status, message: 'Sent the LINE confirmation for APT-4821.' };
    const sendConfirmation = vi.fn(async () => outcome);
    const ctx = fakeCtx({ params: { reference: 'APT-4821' } });
    await controllerSending(sendConfirmation).notify(ctx);
    expect(sendConfirmation).toHaveBeenCalledExactlyOnceWith('APT-4821');
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(outcome);
  });

  it.each([
    ['not_found', 404],
    ['not_confirmed', 409],
    ['past', 422],
    ['failed', 502],
    ['not_configured', 503],
  ])('answers %s with %i and its message, for the board to show', async (status, httpStatus) => {
    const sendConfirmation = vi.fn(async () => ({ reference: 'APT-4821', status, message: 'Why nothing went out.' }));
    const ctx = fakeCtx({ params: { reference: 'APT-4821' } });
    await controllerSending(sendConfirmation).notify(ctx);
    expect(ctx.status).toBe(httpStatus);
    expect(ctx.body.error).toEqual({ message: 'Why nothing went out.', details: { code: status } });
  });

  it('rejects a malformed reference without sending', async () => {
    const sendConfirmation = vi.fn();
    const ctx = fakeCtx({ params: { reference: 'APT-48' } });
    await controllerSending(sendConfirmation).notify(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.details.code).toBe('invalid_input');
    expect(sendConfirmation).not.toHaveBeenCalled();
  });
});

describe('questions controller', () => {
  /** The controller over a service that has only `methods`, and a plugin config of `config`: the defaults when there is none. */
  const controllerOver = (methods: Record<string, unknown>, config: Record<string, unknown> = {}) =>
    questionsController({ strapi: fakeStrapi({ services: { questions: methods }, config }) });

  describe('list', () => {
    const questions = [{ reference: 'Q-4821', status: 'open', customer: 'line:Uaaa…aa' }];

    it('lists with the filters from the query string, and answers the questions', async () => {
      const list = vi.fn(async () => ({ ok: true, value: questions }));
      const ctx = fakeCtx({ query: { status: 'answered', limit: '5' } });

      await controllerOver({ list }).list(ctx);

      expect(list).toHaveBeenCalledExactlyOnceWith({ status: 'answered', limit: 5 });
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ questions });
    });

    it('lists with no filters when the query string has none, and ignores what it does not know', async () => {
      const list = vi.fn(async () => ({ ok: true, value: [] }));
      await controllerOver({ list }).list(fakeCtx());
      await controllerOver({ list }).list(fakeCtx({ query: { search: 'coffret' } }));
      expect(list.mock.calls).toEqual([[{}], [{}]]);
    });

    it.each([
      ['open', '1'],
      ['answered', '100'],
      ['all', '50'],
    ])('accepts the status %s with the limit %s', async (status, limit) => {
      const list = vi.fn(async () => ({ ok: true, value: [] }));
      const ctx = fakeCtx({ query: { status, limit } });
      await controllerOver({ list }).list(ctx);
      expect(list).toHaveBeenCalledExactlyOnceWith({ status, limit: Number(limit) });
      expectNoError(ctx);
    });

    it('answers bad filters with 400 invalid_input and never calls the service', async () => {
      const list = vi.fn();
      for (const query of [{ status: 'pending' }, { status: ['open', 'all'] }, { limit: '0' }, { limit: '101' }, { limit: '2.5' }, { limit: 'ten' }, { limit: '' }]) {
        const ctx = fakeCtx({ query });
        await controllerOver({ list }).list(ctx);
        expect(ctx.status, JSON.stringify(query)).toBe(400);
        expect(ctx.body.error.details).toEqual({ code: 'invalid_input', hint: 'Fix the filters and try again.' });
      }
      expect(list).not.toHaveBeenCalled();
    });

    it("answers a failure of the service with its code, message and hint", async () => {
      const list = vi.fn(async () => ({ ok: false, code: 'invalid_input', message: 'Not possible.', hint: 'Try another.' }));
      const ctx = fakeCtx();
      await controllerOver({ list }).list(ctx);
      expect(ctx.status).toBe(400);
      expect(ctx.body.error).toEqual({ message: 'Not possible.', details: { code: 'invalid_input', hint: 'Try another.' } });
    });
  });

  const OUTCOME = { reference: 'Q-4821', status: 'sent', message: 'Sent the LINE message for Q-4821.' };
  const ANSWER = { text: 'Yes, a watch up to 42 mm fits.', addToKnowledge: true, category: 'sizing' };

  // What Let them know and Answer do alike: read the reference, sign with the admin's name, and answer by the outcome.
  describe.each([
    { action: 'notify', body: undefined, args: (staffName: string | null) => ['Q-4821', staffName] },
    { action: 'answer', body: ANSWER, args: (staffName: string | null) => ['Q-4821', ANSWER, staffName] },
  ])('$action', ({ action, body, args }) => {
    const ctxFor = (overrides: Record<string, unknown> = {}) =>
      fakeCtx({ params: { reference: 'Q-4821' }, state: { user: { firstname: 'Jane' } }, request: { body }, ...overrides });
    const run = (service: unknown, ctx: unknown, config: Record<string, unknown> = {}) =>
      (controllerOver({ [action]: service }, config) as any)[action](ctx);
    const staffNameFor = async (firstname: unknown, config: Record<string, unknown> = {}) => {
      const service = vi.fn(async () => OUTCOME);
      await run(service, ctxFor({ state: { user: { firstname } } }), config);
      expect(service).toHaveBeenCalledOnce();
      return (service.mock.calls[0] as unknown[]).at(-1);
    };

    it("passes the signed-in admin's first name as the staff name, and answers the outcome with 200 when LINE took it", async () => {
      const service = vi.fn(async () => OUTCOME);
      const ctx = ctxFor();

      await run(service, ctx);

      // No time argument: nothing in the request can move the service clock.
      expect(service).toHaveBeenCalledExactlyOnceWith(...args('Jane'));
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual(OUTCOME);
      expectNoError(ctx);
    });

    it.each([
      ['with the knowledge entry it made', { knowledgeDocumentId: 'k-new' }],
      [
        'with a warning, when something after the message went wrong',
        { message: "Sent the LINE message for Q-4821, but recording it failed (database is locked). Don't send it again.", warning: true },
      ],
      [
        'with a warning and no entry, when the entry could not be added',
        { message: "Sent the answer to Q-4821 on LINE. It couldn't be added to product knowledge: database is locked", warning: true },
      ],
    ])('answers a sent outcome as it is, %s, with 200', async (_label, fields) => {
      const sent = { ...OUTCOME, ...fields };
      const ctx = ctxFor();
      await run(vi.fn(async () => sent), ctx);
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual(sent);
      expectNoError(ctx);
    });

    it('answers a sent outcome with no warning as it is: there is no warning key at all', async () => {
      const ctx = ctxFor();
      await run(vi.fn(async () => OUTCOME), ctx);
      expect(ctx.body).not.toHaveProperty('warning');
    });

    it.each([
      ['Jane', 'Jane'],
      ['  Jane \n', 'Jane'],
      ['', null],
      ['   ', null],
      [undefined, null],
      [null, null],
      [42, null],
      [{ first: 'Jane' }, null],
      ['Mary   Ann', 'Mary Ann'],
    ])('takes %j for the first name as the staff name %j', async (firstname, staffName) => {
      const service = vi.fn(async () => OUTCOME);
      await run(service, ctxFor({ state: { user: { firstname } } }));
      expect(service).toHaveBeenCalledExactlyOnceWith(...args(staffName as string | null));
    });

    // The staff name is recorded in a field of 100 UTF-16 units, and an emoji is two of them: the name is cut like the
    // customer's LINE name, whole characters only, ending with "…" when it was cut.
    it.each([
      ['100 letters stay whole', 'J'.repeat(100), 'J'.repeat(100)],
      ['50 emoji, 100 units, stay whole', '😀'.repeat(50), '😀'.repeat(50)],
      ['150 letters are cut to 99 and an ellipsis', 'J'.repeat(150), `${'J'.repeat(99)}…`],
      ['60 emoji are cut to 49 and an ellipsis, none in half', '😀'.repeat(60), `${'😀'.repeat(49)}…`],
      ['99 letters and an emoji, whose halves straddle the cut, are cut to the 99 letters', `${'J'.repeat(99)}😀`, `${'J'.repeat(99)}…`],
    ])('cuts the staff name to 100 UTF-16 units: %s', async (_label, firstname, staffName) => {
      const name = (await staffNameFor(firstname)) as string;
      expect(name).toBe(staffName);
      expect(name.length).toBeLessThanOrEqual(100);
      expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    });

    // An admin whose first name is the house's would have the message say "this is Maison, a client advisor at Maison", and
    // sign "Maison, Maison": the message speaks for the team instead, whatever the capitals and the spaces around it.
    it.each(['Maison', 'maison', 'MAISON', 'mAiSoN', '  Maison \n', 'メゾン', ' メゾン '])(
      'speaks for the team, with null for the staff name, for the first name %j',
      async (firstname) => {
        expect(await staffNameFor(firstname)).toBeNull();
      }
    );

    it.each(['Maisonette', 'Maison Paul', 'La Maison', 'メゾンヌ', 'Jane'])('signs with %j: it is not the house name, only like it', async (firstname) => {
      expect(await staffNameFor(firstname)).toBe(firstname);
    });

    describe("with the house's name set in the config", () => {
      const config = { houseName: { ja: 'アトリエ・ルージュ', en: 'Atelier Rouge' } };

      it.each(['Atelier Rouge', 'atelier rouge', ' ATELIER ROUGE ', 'アトリエ・ルージュ', ' アトリエ・ルージュ\n'])(
        'speaks for the team for the first name %j: either of the two names',
        async (firstname) => {
          expect(await staffNameFor(firstname, config)).toBeNull();
        }
      );

      it.each(['Maison', 'maison'])('still speaks for the team for %j', async (firstname) => {
        expect(await staffNameFor(firstname, config)).toBeNull();
      });

      it.each(['Jane', 'Atelier', 'Rouge'])('signs with %j', async (firstname) => {
        expect(await staffNameFor(firstname, config)).toBe(firstname);
      });

      it('takes the names with the spaces around them left out, as the config may have them', async () => {
        expect(await staffNameFor('Atelier Rouge', { houseName: { ja: ' アトリエ ', en: ' Atelier Rouge ' } })).toBeNull();
        expect(await staffNameFor('アトリエ', { houseName: { ja: ' アトリエ ', en: ' Atelier Rouge ' } })).toBeNull();
      });
    });

    it.each([
      ['no state', { state: undefined }],
      ['no user', { state: {} }],
      ['a user with no first name', { state: { user: { email: 'jane@example.test' } } }],
    ])('speaks for the team, with null for the staff name, for %s', async (_label, overrides) => {
      const service = vi.fn(async () => OUTCOME);
      await run(service, ctxFor(overrides));
      expect(service).toHaveBeenCalledExactlyOnceWith(...args(null));
    });

    it('never takes the staff name from the request', async () => {
      const service = vi.fn(async () => OUTCOME);
      const ctx = ctxFor({ query: { staffName: 'Mallory' }, request: { body: { ...(body as object), staffName: 'Mallory', firstname: 'Mallory' } } });
      await run(service, ctx);
      expect(service).toHaveBeenCalledExactlyOnceWith(...args('Jane'));
    });

    it.each([
      ['not_found', 404],
      ['already_taken', 409],
      ['already_answered', 409],
      ['failed', 502],
      ['not_configured', 503],
    ])('answers %s with %i, and its message for the admin to show', async (status, httpStatus) => {
      const service = vi.fn(async () => ({ reference: 'Q-4821', status, message: 'Why nothing went out.' }));
      const ctx = ctxFor();

      await run(service, ctx);

      expect(ctx.status).toBe(httpStatus);
      expect(ctx.body.error).toEqual({ message: 'Why nothing went out.', details: { code: status } });
    });

    it.each([
      ['not_found', 'notFound'],
      ['already_taken', 'conflict'],
      ['already_answered', 'conflict'],
      ['failed', 'badGateway'],
      ['not_configured', 'serviceUnavailable'],
    ])("calls Strapi's %s error helper, %s", async (status, helper) => {
      const ctx = ctxFor();
      await run(vi.fn(async () => ({ reference: 'Q-4821', status, message: 'Why nothing went out.' })), ctx);
      expect(ctx[helper]).toHaveBeenCalledExactlyOnceWith('Why nothing went out.', { code: status });
    });

    it.each(['Q-48', 'Q-482', 'Q-48210', 'APT-4821', 'q-4821', 'Q-48a1', 'Q-4821 ', ' Q-4821', ''])(
      'refuses the reference %j with 400, and never calls the service',
      async (reference) => {
        const service = vi.fn();
        const ctx = ctxFor({ params: { reference } });

        await run(service, ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body.error.details).toEqual({ code: 'invalid_input', hint: 'Use a reference like Q-4821.' });
        expect(ctx.body.error.message).toContain('Use a reference like Q-4821.');
        expect(service).not.toHaveBeenCalled();
      }
    );

    it('refuses a request with no reference with 400', async () => {
      const service = vi.fn();
      const ctx = ctxFor({ params: {} });
      await run(service, ctx);
      expect(ctx.status).toBe(400);
      expect(service).not.toHaveBeenCalled();
    });
  });

  describe('answer, with the staff member’s reply', () => {
    const answer = (body: unknown, overrides: Record<string, unknown> = {}) => {
      const service = vi.fn(async () => OUTCOME);
      const ctx = fakeCtx({ params: { reference: 'Q-4821' }, state: { user: { firstname: 'Jane' } }, request: { body }, ...overrides });
      return { service, ctx, done: controllerOver({ answer: service }).answer(ctx) };
    };

    it('adds the answer to product knowledge by default: without addToKnowledge, a category is needed', async () => {
      const { service, done } = answer({ text: ANSWER.text, category: 'sizing' });
      await done;
      expect(service).toHaveBeenCalledExactlyOnceWith('Q-4821', { text: ANSWER.text, addToKnowledge: true, category: 'sizing' }, 'Jane');
    });

    it('needs no category when it is not added to product knowledge', async () => {
      const { service, done } = answer({ text: ANSWER.text, addToKnowledge: false });
      await done;
      expect(service).toHaveBeenCalledExactlyOnceWith('Q-4821', { text: ANSWER.text, addToKnowledge: false }, 'Jane');
    });

    it('passes a category along with addToKnowledge false, for the service to ignore', async () => {
      const { service, done } = answer({ text: ANSWER.text, addToKnowledge: false, category: 'care' });
      await done;
      expect(service).toHaveBeenCalledExactlyOnceWith('Q-4821', { text: ANSWER.text, addToKnowledge: false, category: 'care' }, 'Jane');
    });

    it.each(['care', 'materials', 'sizing', 'personalization', 'delivery', 'returns', 'repairs', 'warranty', 'gifting', 'store'])(
      'accepts the knowledge category %s',
      async (category) => {
        const { service, ctx, done } = answer({ ...ANSWER, category });
        await done;
        expect(service.mock.calls[0][1]).toEqual({ ...ANSWER, category });
        expectNoError(ctx);
      }
    );

    it('trims the text before it is counted and sent', async () => {
      const { service, done } = answer({ ...ANSWER, text: `  ${ANSWER.text}\n` });
      await done;
      expect(service.mock.calls[0][1].text).toBe(ANSWER.text);
    });

    describe('the title in product knowledge', () => {
      it('passes the title along with the answer, trimmed, for the service to use', async () => {
        const { service, done } = answer({ ...ANSWER, title: '  Does a watch fit in the coffret?\n' });
        await done;
        expect(service).toHaveBeenCalledExactlyOnceWith('Q-4821', { ...ANSWER, title: 'Does a watch fit in the coffret?' }, 'Jane');
      });

      it('passes no title when the body has none: the service makes the customer’s question the title', async () => {
        const { service, done } = answer(ANSWER);
        await done;
        expect(service.mock.calls[0][1]).not.toHaveProperty('title');
      });

      it.each([1, 200])('accepts a title of %i characters', async (length) => {
        const { service, ctx, done } = answer({ ...ANSWER, title: 'x'.repeat(length) });
        await done;
        expect(service).toHaveBeenCalledOnce();
        expectNoError(ctx);
      });

      it.each([
        ['an empty title', ''],
        ['a title of spaces', '  \n '],
        ['a title of 201 characters', 'x'.repeat(201)],
        ['a title that is not text', 42],
        ['a title that is null', null],
      ])('refuses %s with 400 invalid_input, saying it is the title, before calling the service', async (_label, title) => {
        const { service, ctx, done } = answer({ ...ANSWER, title });

        await done;

        expect(ctx.status).toBe(400);
        expect(ctx.body.error.message).toMatch(/^title: /);
        expect(ctx.body.error.details.code).toBe('invalid_input');
        expect(service).not.toHaveBeenCalled();
      });

      it('passes a title along with addToKnowledge false, for the service to leave unused', async () => {
        const { service, done } = answer({ text: ANSWER.text, addToKnowledge: false, title: 'Anything' });
        await done;
        expect(service).toHaveBeenCalledExactlyOnceWith('Q-4821', { text: ANSWER.text, addToKnowledge: false, title: 'Anything' }, 'Jane');
      });
    });

    it.each([1, 2000])('accepts an answer of %i characters', async (length) => {
      const { service, ctx, done } = answer({ ...ANSWER, text: 'x'.repeat(length) });
      await done;
      expect(service).toHaveBeenCalledOnce();
      expectNoError(ctx);
    });

    it('counts the answer after trimming it: 2,000 characters between spaces are accepted', async () => {
      const { service, done } = answer({ ...ANSWER, text: ` ${'x'.repeat(2000)} ` });
      await done;
      expect(service.mock.calls[0][1].text).toBe('x'.repeat(2000));
    });

    it.each([
      ['an empty text', { ...ANSWER, text: '' }],
      ['a text of spaces', { ...ANSWER, text: '  \n ' }],
      ['2,001 characters', { ...ANSWER, text: 'x'.repeat(2001) }],
      ['no text', { addToKnowledge: false }],
      ['a text that is not a string', { ...ANSWER, text: 42 }],
      ['addToKnowledge true without a category', { text: ANSWER.text, addToKnowledge: true }],
      ['addToKnowledge left out, which means true, without a category', { text: ANSWER.text }],
      ['a category that is not one', { ...ANSWER, category: 'sizes' }],
      ['addToKnowledge that is not true or false', { ...ANSWER, addToKnowledge: 'yes' }],
      ['a body that is not an object', 'Yes, it fits.'],
      ['no body', undefined],
      ['an empty body', {}],
    ])('refuses %s with 400 invalid_input and the hint, before calling the service', async (_label, body) => {
      const { service, ctx, done } = answer(body);

      await done;

      expect(ctx.status).toBe(400);
      expect(ctx.badRequest).toHaveBeenCalledOnce();
      expect(ctx.body.error.details).toEqual({
        code: 'invalid_input',
        hint: 'Write an answer of up to 2,000 characters, and pick a category to add it to product knowledge.',
      });
      expect(service).not.toHaveBeenCalled();
    });

    it('says which field is wrong, with the schema’s own words', async () => {
      const { ctx, done } = answer({ text: ANSWER.text, addToKnowledge: true });
      await done;
      expect(ctx.body.error.message).toContain('category: Pick a category to add the answer to product knowledge.');
    });

    it('says the text is missing, not that the body is, when there is no body at all', async () => {
      const { ctx, done } = answer(undefined);
      await done;
      expect(ctx.body.error.message).toMatch(/^text: /);
    });

    it('reads the reference before the body: a bad one gets the reference hint, whatever the body', async () => {
      const { service, ctx, done } = answer({}, { params: { reference: 'Q-48' } });
      await done;
      expect(ctx.status).toBe(400);
      expect(ctx.body.error.details.hint).toBe('Use a reference like Q-4821.');
      expect(service).not.toHaveBeenCalled();
    });
  });
});

describe('inquiries controller', () => {
  /** The controller over a service that has only `methods`, and a plugin config of `config`: the defaults when there is none. */
  const controllerOver = (methods: Record<string, unknown>, config: Record<string, unknown> = {}) =>
    inquiriesController({ strapi: fakeStrapi({ services: { inquiries: methods }, config }) });
  /** The inquiry as staff see it, as the actions answer it: all that matters here is that it reaches the page as it is. */
  const VIEW = { documentId: 'inq4abc', customer: 'line:Uaaa…aa', status: 'open', queue: 'complaint' };
  const FAILURE = { ok: false, message: 'Not possible.', hint: 'Try another.' };

  describe('list', () => {
    const inquiries = [VIEW];

    it('lists with the filters from the query string, and answers the inquiries', async () => {
      const list = vi.fn(async () => ({ ok: true, value: inquiries }));
      const ctx = fakeCtx({ query: { filter: 'complaint', limit: '5' } });

      await controllerOver({ list }).list(ctx);

      expect(list).toHaveBeenCalledExactlyOnceWith({ filter: 'complaint', limit: 5 });
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ inquiries });
      expectNoError(ctx);
    });

    it('lists with no filters when the query string has none, and ignores what it does not know', async () => {
      const list = vi.fn(async () => ({ ok: true, value: [] }));
      await controllerOver({ list }).list(fakeCtx());
      await controllerOver({ list }).list(fakeCtx({ query: { search: 'coffret' } }));
      expect(list.mock.calls).toEqual([[{}], [{}]]);
    });

    it.each(INQUIRY_FILTERS)('accepts the filter %s', async (filter) => {
      const list = vi.fn(async () => ({ ok: true, value: [] }));
      const ctx = fakeCtx({ query: { filter } });
      await controllerOver({ list }).list(ctx);
      expect(list).toHaveBeenCalledExactlyOnceWith({ filter });
      expectNoError(ctx);
    });

    it.each(['1', '50', '100'])('accepts the limit %s', async (limit) => {
      const list = vi.fn(async () => ({ ok: true, value: [] }));
      await controllerOver({ list }).list(fakeCtx({ query: { limit } }));
      expect(list).toHaveBeenCalledExactlyOnceWith({ limit: Number(limit) });
    });

    it('answers bad filters with 400 invalid_input and never calls the service', async () => {
      const list = vi.fn();
      const queries = [
        { filter: 'open' },
        { filter: 'Complaint' },
        { filter: '' },
        { filter: ['all', 'praise'] },
        { filter: 'toString' },
        { limit: '0' },
        { limit: '101' },
        { limit: '2.5' },
        { limit: 'ten' },
        { limit: '' },
      ];
      for (const query of queries) {
        const ctx = fakeCtx({ query });
        await controllerOver({ list }).list(ctx);
        expect(ctx.status, JSON.stringify(query)).toBe(400);
        expect(ctx.body.error.details).toEqual({ code: 'invalid_input', hint: 'Fix the filters and try again.' });
      }
      expect(list).not.toHaveBeenCalled();
    });

    it('answers a failure of the service with 400, its code, message and hint', async () => {
      const list = vi.fn(async () => ({ ...FAILURE, code: 'invalid_input' }));
      const ctx = fakeCtx();
      await controllerOver({ list }).list(ctx);
      expect(ctx.status).toBe(400);
      expect(ctx.body.error).toEqual({ message: 'Not possible.', details: { code: 'invalid_input', hint: 'Try another.' } });
    });
  });

  describe('summary', () => {
    const summary = { needsAnswer: 2, complaint: 1, praise: 0, notLabelled: 3 };

    it("returns the service's counts as they are", async () => {
      const service = vi.fn(async () => summary);
      const ctx = fakeCtx();

      await controllerOver({ summary: service }).summary(ctx);

      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual(summary);
      expectNoError(ctx);
    });

    it('takes nothing from the request: it counts what is there', async () => {
      const service = vi.fn(async () => summary);
      await controllerOver({ summary: service }).summary(fakeCtx({ query: { filter: 'praise', limit: '1' } }));
      expect(service).toHaveBeenCalledExactlyOnceWith();
    });

    it("lets a service failure reach Strapi's error handling, so the widget shows its error and not made-up numbers", async () => {
      const service = vi.fn(async () => {
        throw new Error('database is down');
      });
      const ctx = fakeCtx();
      await expect(controllerOver({ summary: service }).summary(ctx)).rejects.toThrow('database is down');
      expect(ctx.body).toBeUndefined();
    });
  });

  describe('quota', () => {
    it("returns whether there is a token, with the month's total and the limit, as they are", async () => {
      const service = vi.fn(async () => ({ configured: true, used: 12, limit: 200 }));
      const ctx = fakeCtx();

      await controllerOver({ quota: service }).quota(ctx);

      expect(service).toHaveBeenCalledExactlyOnceWith();
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ configured: true, used: 12, limit: 200 });
    });

    it.each([
      ['no limit', { configured: true, used: 12, limit: null }],
      ['no total, when LINE gave no answer', { configured: true, used: null, limit: null }],
      ['no token: replies cannot be sent', { configured: false, used: null, limit: null }],
    ])('returns %s as a 200: the page shows what it has', async (_label, quota) => {
      const ctx = fakeCtx();
      await controllerOver({ quota: vi.fn(async () => quota) }).quota(ctx);
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual(quota);
      expectNoError(ctx);
    });
  });

  // What Close, Change label and Label again do alike when the service refuses: answer its failure by its code.
  describe.each([
    { action: 'close', serviceMethod: 'close', body: { reason: 'spam' } },
    { action: 'label', serviceMethod: 'changeLabel', body: { kind: 'praise', sentimentLabel: 'positive' } },
    { action: 'labelAgain', serviceMethod: 'labelAgain', body: undefined },
  ])('$action, when the service refuses', ({ action, serviceMethod, body }) => {
    const refuse = async (code: string) => {
      const ctx = fakeCtx({ params: { documentId: 'inq4abc' }, request: { body } });
      await (controllerOver({ [serviceMethod]: vi.fn(async () => ({ ...FAILURE, code })) }) as any)[action](ctx);
      return ctx;
    };

    it.each([
      ['not_found', 404, 'notFound'],
      ['already_closed', 409, 'conflict'],
      ['already_replied', 409, 'conflict'],
      ['not_failed', 409, 'conflict'],
      ['invalid_input', 400, 'badRequest'],
    ])('answers %s with %i, through ctx.%s, with its code, message and hint', async (code, status, helper) => {
      const ctx = await refuse(code);

      expect(ctx.status).toBe(status);
      expect(ctx[helper]).toHaveBeenCalledExactlyOnceWith('Not possible.', { code, hint: 'Try another.' });
      expect(ctx.body.error).toEqual({ message: 'Not possible.', details: { code, hint: 'Try another.' } });
    });
  });

  describe('close', () => {
    const CLOSED = { ...VIEW, status: 'closed', closeReason: 'not-needed' };
    const closeWith = (body: unknown) => {
      const close = vi.fn(async () => ({ ok: true, value: CLOSED }));
      const ctx = fakeCtx({ params: { documentId: 'inq4abc' }, request: { body } });
      return { close, ctx, done: controllerOver({ close }).close(ctx) };
    };

    it('closes the inquiry for the reason, and answers it as staff see it, with a message', async () => {
      const { close, ctx, done } = closeWith({ reason: 'not-needed' });

      await done;

      expect(close).toHaveBeenCalledExactlyOnceWith('inq4abc', 'not-needed');
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ inquiry: CLOSED, message: 'Closed the inquiry.' });
      expectNoError(ctx);
    });

    it.each(CLOSE_REASONS)('accepts the reason %s', async (reason) => {
      const { close, ctx, done } = closeWith({ reason });
      await done;
      expect(close).toHaveBeenCalledExactlyOnceWith('inq4abc', reason);
      expectNoError(ctx);
    });

    it.each([
      ['a reason that is not one', { reason: 'resolved' }, 'reason'],
      ['a capital', { reason: 'Spam' }, 'reason'],
      ['an empty reason', { reason: '' }, 'reason'],
      ['a reason that is not text', { reason: 7 }, 'reason'],
      ['no reason', {}, 'reason'],
      ['no body', undefined, 'reason'],
      ['a body that is not an object', 'spam', 'input'],
    ])('refuses %s with 400 invalid_input and the hint, before calling the service', async (_label, body, field) => {
      const { close, ctx, done } = closeWith(body);

      await done;

      expect(ctx.status).toBe(400);
      expect(ctx.body.error.message.startsWith(`${field}: `)).toBe(true);
      expect(ctx.body.error.details).toEqual({ code: 'invalid_input', hint: 'Use one of answered-elsewhere, not-needed, spam.' });
      expect(close).not.toHaveBeenCalled();
    });

    it('takes the reason from the body only: one in the query string is no reason', async () => {
      const close = vi.fn();
      const ctx = fakeCtx({ params: { documentId: 'inq4abc' }, query: { reason: 'spam' }, request: { body: {} } });
      await controllerOver({ close }).close(ctx);
      expect(ctx.status).toBe(400);
      expect(close).not.toHaveBeenCalled();
    });
  });

  describe('label', () => {
    const LABELLED = { ...VIEW, kind: 'praise', queue: 'praise', humanCorrected: true };
    const labelWith = (body: unknown) => {
      const changeLabel = vi.fn(async () => ({ ok: true, value: LABELLED }));
      const ctx = fakeCtx({ params: { documentId: 'inq4abc' }, request: { body } });
      return { changeLabel, ctx, done: controllerOver({ changeLabel }).label(ctx) };
    };

    it('changes the label, and answers the inquiry as staff see it, with a message', async () => {
      const { changeLabel, ctx, done } = labelWith({ kind: 'praise', sentimentLabel: 'positive' });

      await done;

      expect(changeLabel).toHaveBeenCalledExactlyOnceWith('inq4abc', { kind: 'praise', sentimentLabel: 'positive' });
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ inquiry: LABELLED, message: 'Changed the label.' });
      expectNoError(ctx);
    });

    it.each([
      ['a kind alone', { kind: 'complaint' }],
      ['a sentiment alone', { sentimentLabel: 'negative' }],
    ])('takes %s', async (_label, body) => {
      const { changeLabel, done } = labelWith(body);
      await done;
      expect(changeLabel).toHaveBeenCalledExactlyOnceWith('inq4abc', body);
    });

    it.each(INQUIRY_KINDS)('accepts the kind %s', async (kind) => {
      const { changeLabel, done } = labelWith({ kind });
      await done;
      expect(changeLabel).toHaveBeenCalledExactlyOnceWith('inq4abc', { kind });
    });

    it.each(SENTIMENT_LABELS)('accepts the sentiment %s', async (sentimentLabel) => {
      const { changeLabel, done } = labelWith({ sentimentLabel });
      await done;
      expect(changeLabel).toHaveBeenCalledExactlyOnceWith('inq4abc', { sentimentLabel });
    });

    it('passes on only the kind and the sentiment: nothing else in the body reaches the service', async () => {
      const { changeLabel, done } = labelWith({ kind: 'praise', queue: 'needs-answer', humanCorrected: false, status: 'open', customer: 'line:Ubbb' });
      await done;
      expect(changeLabel).toHaveBeenCalledExactlyOnceWith('inq4abc', { kind: 'praise' });
    });

    it.each([
      ['nothing in the body', {}],
      ['a kind and a sentiment that are both null', { kind: null, sentimentLabel: null }],
      ['a kind that is not one', { kind: 'angry' }],
      ['a sentiment that is not one', { sentimentLabel: 'angry' }],
      ['a score in place of a sentiment', { sentimentLabel: -0.6 }],
      ['a body that is not an object', 'praise'],
      ['no body', undefined],
    ])('refuses %s with 400 invalid_input and the hint, before calling the service', async (_label, body) => {
      const { changeLabel, ctx, done } = labelWith(body);

      await done;

      expect(ctx.status).toBe(400);
      expect(ctx.body.error.details).toEqual({
        code: 'invalid_input',
        hint: 'Give a kind (question, complaint, praise, other), a sentiment (positive, neutral, negative), or both.',
      });
      expect(changeLabel).not.toHaveBeenCalled();
    });

    it('says what is missing, with the schema’s own words', async () => {
      const { ctx, done } = labelWith({});
      await done;
      expect(ctx.body.error.message).toContain('Give a kind, a sentiment, or both.');
    });
  });

  describe('labelAgain', () => {
    const PENDING_AGAIN = { ...VIEW, analysisStatus: 'pending', analysisAttempts: 0 };

    it('labels the inquiry again, and answers it as staff see it, with a message', async () => {
      const labelAgain = vi.fn(async () => ({ ok: true, value: PENDING_AGAIN }));
      const ctx = fakeCtx({ params: { documentId: 'inq4abc' } });

      await controllerOver({ labelAgain }).labelAgain(ctx);

      expect(labelAgain).toHaveBeenCalledExactlyOnceWith('inq4abc');
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ inquiry: PENDING_AGAIN, message: 'It will be labelled again within a minute.' });
      expectNoError(ctx);
    });

    it('needs no body, and takes nothing from one', async () => {
      const labelAgain = vi.fn(async () => ({ ok: true, value: PENDING_AGAIN }));
      const ctx = fakeCtx({ params: { documentId: 'inq4abc' }, request: { body: { analysisStatus: 'analyzed', attempts: 9 } } });

      await controllerOver({ labelAgain }).labelAgain(ctx);

      expect(labelAgain).toHaveBeenCalledExactlyOnceWith('inq4abc');
      expectNoError(ctx);
    });
  });

  describe('reply', () => {
    const TEXT = 'We are sorry about the clasp. A member of our team will call you tomorrow.';
    const SENT = { documentId: 'inq4abc', status: 'sent', message: 'Sent the reply on LINE.' };
    const ctxFor = (overrides: Record<string, unknown> = {}) =>
      fakeCtx({ params: { documentId: 'inq4abc' }, state: { user: { firstname: 'Jane' } }, request: { body: { text: TEXT } }, ...overrides });
    const run = (service: unknown, ctx: unknown, config: Record<string, unknown> = {}) => controllerOver({ reply: service }, config).reply(ctx);
    const staffNameFor = async (firstname: unknown, config: Record<string, unknown> = {}) => {
      const service = vi.fn(async () => SENT);
      await run(service, ctxFor({ state: { user: { firstname } } }), config);
      expect(service).toHaveBeenCalledOnce();
      return (service.mock.calls[0] as unknown[]).at(-1);
    };

    it("passes the inquiry, the text and the signed-in admin's first name, and answers the outcome with 200 when LINE took it", async () => {
      const service = vi.fn(async () => SENT);
      const ctx = ctxFor();

      await run(service, ctx);

      // No time argument: nothing in the request can move the service clock.
      expect(service).toHaveBeenCalledExactlyOnceWith('inq4abc', TEXT, 'Jane');
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual(SENT);
      expect(ctx.body).not.toHaveProperty('warning');
      expectNoError(ctx);
    });

    it('answers a sent outcome with a warning as it is, with 200: the customer has the reply, and staff must read what went wrong', async () => {
      const sent = { ...SENT, message: "Sent the reply on LINE, but recording it failed (database is locked). Don't send it again.", warning: true };
      const ctx = ctxFor();
      await run(vi.fn(async () => sent), ctx);
      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual(sent);
      expectNoError(ctx);
    });

    it.each([
      ['Jane', 'Jane'],
      ['  Jane \n', 'Jane'],
      ['', null],
      ['   ', null],
      [undefined, null],
      [null, null],
      [42, null],
      ['Mary   Ann', 'Mary Ann'],
    ])('takes %j for the first name as the staff name %j', async (firstname, staffName) => {
      expect(await staffNameFor(firstname)).toBe(staffName);
    });

    it('cuts the staff name to the 100 UTF-16 units the row holds, whole characters only', async () => {
      expect(await staffNameFor('😀'.repeat(60))).toBe(`${'😀'.repeat(49)}…`);
      expect(await staffNameFor('J'.repeat(100))).toBe('J'.repeat(100));
    });

    // An admin whose first name is the house's would sign "Maison, Maison": the reply is recorded as Maison's instead.
    it.each(['Maison', 'maison', '  MAISON \n', 'メゾン'])('speaks for the team, with null for the staff name, for the first name %j', async (firstname) => {
      expect(await staffNameFor(firstname)).toBeNull();
    });

    it("speaks for the team for either name in the config, as the questions' replies do", async () => {
      const config = { houseName: { ja: 'アトリエ・ルージュ', en: 'Atelier Rouge' } };
      expect(await staffNameFor(' ATELIER ROUGE ', config)).toBeNull();
      expect(await staffNameFor('アトリエ・ルージュ', config)).toBeNull();
      expect(await staffNameFor('Atelier', config)).toBe('Atelier');
    });

    it.each([
      ['no state', { state: undefined }],
      ['no user', { state: {} }],
      ['a user with no first name', { state: { user: { email: 'jane@example.test' } } }],
    ])('speaks for the team, with null for the staff name, for %s', async (_label, overrides) => {
      const service = vi.fn(async () => SENT);
      await run(service, ctxFor(overrides));
      expect(service).toHaveBeenCalledExactlyOnceWith('inq4abc', TEXT, null);
    });

    it('never takes the staff name from the request', async () => {
      const service = vi.fn(async () => SENT);
      const ctx = ctxFor({ query: { staffName: 'Mallory' }, request: { body: { text: TEXT, staffName: 'Mallory', firstname: 'Mallory', repliedBy: 'Mallory' } } });
      await run(service, ctx);
      expect(service).toHaveBeenCalledExactlyOnceWith('inq4abc', TEXT, 'Jane');
    });

    it('never takes the customer, the language or the status from the request: only the text goes on', async () => {
      const service = vi.fn(async () => SENT);
      const ctx = ctxFor({ request: { body: { text: TEXT, customer: 'line:Ubbb', language: 'ja', status: 'open', to: 'Ubbb' } } });
      await run(service, ctx);
      expect(service.mock.calls[0]).toEqual(['inq4abc', TEXT, 'Jane']);
    });

    it.each([
      ['not_found', 404],
      ['already_closed', 409],
      ['already_replied', 409],
      ['use_question', 409],
      ['failed', 502],
      ['not_configured', 503],
    ])('answers %s with %i, and its message for the page to show', async (status, httpStatus) => {
      const service = vi.fn(async () => ({ documentId: 'inq4abc', status, message: 'Why nothing went out.' }));
      const ctx = ctxFor();

      await run(service, ctx);

      expect(ctx.status).toBe(httpStatus);
      expect(ctx.body.error).toEqual({ message: 'Why nothing went out.', details: { code: status } });
    });

    it.each([
      ['not_found', 'notFound'],
      ['already_closed', 'conflict'],
      ['already_replied', 'conflict'],
      ['use_question', 'conflict'],
      ['failed', 'badGateway'],
      ['not_configured', 'serviceUnavailable'],
    ])("calls Strapi's %s error helper, %s", async (status, helper) => {
      const ctx = ctxFor();
      await run(vi.fn(async () => ({ documentId: 'inq4abc', status, message: 'Why nothing went out.' })), ctx);
      expect(ctx[helper]).toHaveBeenCalledExactlyOnceWith('Why nothing went out.', { code: status });
    });

    it('trims the text before it is counted and sent', async () => {
      const service = vi.fn(async () => SENT);
      await run(service, ctxFor({ request: { body: { text: `  ${TEXT}\n` } } }));
      expect(service.mock.calls[0][1]).toBe(TEXT);
    });

    it.each([1, 2000])('accepts a reply of %i characters', async (length) => {
      const service = vi.fn(async () => SENT);
      const ctx = ctxFor({ request: { body: { text: 'x'.repeat(length) } } });
      await run(service, ctx);
      expect(service).toHaveBeenCalledOnce();
      expectNoError(ctx);
    });

    it('counts the reply after trimming it: 2,000 characters between spaces are accepted', async () => {
      const service = vi.fn(async () => SENT);
      await run(service, ctxFor({ request: { body: { text: ` ${'x'.repeat(2000)} ` } } }));
      expect(service.mock.calls[0][1]).toBe('x'.repeat(2000));
    });

    it.each([
      ['an empty text', { text: '' }, 'text'],
      ['a text of spaces', { text: '  \n ' }, 'text'],
      ['2,001 characters', { text: 'x'.repeat(2001) }, 'text'],
      ['no text', {}, 'text'],
      ['a text that is not a string', { text: 42 }, 'text'],
      ['no body', undefined, 'text'],
      ['a body that is not an object', 'We are sorry.', 'input'],
    ])('refuses %s with 400 invalid_input and the hint, before calling the service', async (_label, body, field) => {
      const service = vi.fn();
      const ctx = ctxFor({ request: { body } });

      await run(service, ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.badRequest).toHaveBeenCalledOnce();
      expect(ctx.body.error.message.startsWith(`${field}: `)).toBe(true);
      expect(ctx.body.error.details).toEqual({ code: 'invalid_input', hint: 'Write a reply of up to 2,000 characters.' });
      expect(service).not.toHaveBeenCalled();
    });
  });
});


describe('demo controller: Load demo activity', () => {
  const ADDED = { created: true, customers: 5, appointments: 5, confirmed: 2, questions: 5, inquiries: 10 };
  const NOTHING = { created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 };
  const controllerStarting = (startDemoActivity: () => Promise<unknown>) => demoController({ strapi: fakeStrapi({ services: { seed: { startDemoActivity } } }) });
  const started = { ok: true, value: { started: true, counts: { appointments: 5, questions: 5, inquiries: 10 }, done: Promise.resolve(ADDED) } };

  it('answers 202 at once, with the counts it will add, when the writes go on in the background', async () => {
    const ctx = fakeCtx();
    await controllerStarting(async () => started).activity(ctx);
    expect(ctx.status).toBe(202);
    expect(ctx.body).toEqual({ started: true, appointments: 5, questions: 5, inquiries: 10 });
    expectNoError(ctx);
  });

  it('answers 200 with the "already there" result when there is nothing to add', async () => {
    const ctx = fakeCtx();
    await controllerStarting(async () => ({ ok: true, value: { started: false, result: NOTHING } })).activity(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(NOTHING);
    expectNoError(ctx);
  });

  it('loads at the real time: nothing in the request reaches the service', async () => {
    const startDemoActivity = vi.fn(async () => started);
    await controllerStarting(startDemoActivity).activity(fakeCtx({ query: { now: '2020-01-01T00:00:00Z' }, request: { body: { now: '2020-01-01' } } }));
    expect(startDemoActivity).toHaveBeenCalledWith();
  });

  it("answers 404 with the service's words and hint when the demo catalog isn't loaded", async () => {
    const ctx = fakeCtx();
    const failure = { ok: false, code: 'not_found', message: 'Load demo catalog first.', hint: 'Press Load demo catalog.' };
    await controllerStarting(async () => failure).activity(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ error: { message: 'Load demo catalog first.', details: { code: 'not_found', hint: 'Press Load demo catalog.' } } });
  });

  it('answers 409 already_loading while a load is still running, in the words the page shows', async () => {
    const ctx = fakeCtx();
    const failure = { ok: false, code: 'already_loading', message: 'Demo activity is still loading.', hint: 'Wait for it.' };
    await controllerStarting(async () => failure).activity(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({ error: { message: 'Demo activity is still loading.', details: { code: 'already_loading', hint: 'Wait for it.' } } });
  });

  it('answers 400 for any other failure', async () => {
    const ctx = fakeCtx();
    await controllerStarting(async () => ({ ok: false, code: 'boutique_closed', message: 'Closed.', hint: 'Check the hours.' })).activity(ctx);
    expect(ctx.status).toBe(400);
  });
});

describe('demo controller: Load demo catalog', () => {
  const NOTHING = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 0 };
  const COUNTS = { collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 16 };
  const controllerStarting = (startDemoCatalog: () => Promise<unknown>) => demoController({ strapi: fakeStrapi({ services: { seed: { startDemoCatalog } } }) });

  it('answers 202 at once, with what it will add, when the writes go on in the background', async () => {
    const ctx = fakeCtx();
    await controllerStarting(async () => ({ ok: true, value: { started: true, counts: COUNTS, done: Promise.resolve(NOTHING) } })).seed(ctx);
    expect(ctx.status).toBe(202);
    expect(ctx.body).toEqual({ started: true, ...COUNTS });
    expectNoError(ctx);
  });

  it('answers 200 at once when the catalog and its product knowledge are all there', async () => {
    const ctx = fakeCtx();
    await controllerStarting(async () => ({ ok: true, value: { started: false, result: NOTHING } })).seed(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(NOTHING);
  });

  it('answers 409 already_loading while a load is still running', async () => {
    const ctx = fakeCtx();
    const failure = { ok: false, code: 'already_loading', message: 'The demo catalog is still loading.', hint: 'Wait for it.' };
    await controllerStarting(async () => failure).seed(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe('already_loading');
  });
});

describe('demo customers: the actions answer 200, as for a message LINE took', () => {
  it("Send again answers 200 with the demo outcome", async () => {
    const outcome = { reference: 'APT-4821', status: 'demo', message: 'Demo customer: no LINE confirmation for APT-4821.' };
    const ctx = fakeCtx({ params: { reference: 'APT-4821' } });
    await controllerSending(async () => outcome).notify(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(outcome);
    expectNoError(ctx);
  });

  it.each(['notify', 'answer'] as const)('questions %s answers 200 with the demo outcome', async (action) => {
    const outcome = { reference: 'Q-4821', status: 'demo', message: 'Marked Q-4821 taken. Demo customer: no LINE message.' };
    const service = vi.fn(async () => outcome);
    const controller = questionsController({ strapi: fakeStrapi({ services: { questions: { notify: service, answer: service } } }) });
    const ctx = fakeCtx({ params: { reference: 'Q-4821' }, request: { body: { text: 'Yes.', addToKnowledge: false } }, state: { user: { firstname: 'Jane' } } });
    await controller[action](ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(outcome);
    expectNoError(ctx);
  });

  it('inquiries reply answers 200 with the demo outcome', async () => {
    const outcome = { documentId: 'inq4abc', status: 'demo', message: 'Marked it replied. Demo customer: no LINE message.' };
    const controller = inquiriesController({ strapi: fakeStrapi({ services: { inquiries: { reply: vi.fn(async () => outcome) } } }) });
    const ctx = fakeCtx({ params: { documentId: 'inq4abc' }, request: { body: { text: 'Thank you.' } }, state: { user: { firstname: 'Jane' } } });
    await controller.reply(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(outcome);
    expectNoError(ctx);
  });
});
