import { describe, expect, it } from 'vitest';
import { ACTION, SAVED_CHATS, UID } from '../../server/src/constants';
import controllers from '../../server/src/controllers';
import routes from '../../server/src/routes';
import { cutTitle } from '../../server/src/services/conversations';
import { CHAT, assistantMessage, chatsWorld, fakeCtx, savedRow, staffMessage, type Doc } from './fake-conversations';
import { fakeStrapi } from './fake-strapi';

const NO_CHAT = 'There is no saved chat with that ID.';
const NOT_SAVED = 'This chat could not be saved.';

describe('cutTitle', () => {
  it('is the words as they were written, on one line', () => {
    expect(cutTitle('Which visits are waiting?')).toBe('Which visits are waiting?');
    expect(cutTitle('  Which visits\n\nare   waiting?  ')).toBe('Which visits are waiting?');
  });

  it('is cut to 80 characters, and an 80-character title is not cut', () => {
    expect(SAVED_CHATS.titleChars).toBe(80);
    expect(cutTitle('a'.repeat(80))).toBe('a'.repeat(80));
    expect(cutTitle('a'.repeat(81))).toBe('a'.repeat(80));
    expect(Array.from(cutTitle('b'.repeat(500)))).toHaveLength(80);
  });

  it('counts characters, not UTF-16 units: a Japanese title and an emoji are never split', () => {
    const japanese = '今日のお客様からの問い合わせを教えてください。'.repeat(5);
    expect(Array.from(cutTitle(japanese))).toHaveLength(80);
    expect(japanese.startsWith(cutTitle(japanese))).toBe(true);
    const emoji = '😀'.repeat(100);
    expect(cutTitle(emoji)).toBe('😀'.repeat(80));
    expect(cutTitle(emoji)).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  // A character as people see it can be several code points: an emoji and its skin tone, a family emoji joined by zero-width joiners, a flag
  // (two regional indicators), a Japanese character with a separate voiced mark. Counting code points would cut one of them in two.
  describe('counts characters as people see them', () => {
    const limit = SAVED_CHATS.titleChars;

    it.each([
      ['an emoji with a skin tone', '👍🏽'],
      ['a family emoji joined by zero-width joiners', '👨‍👩‍👧‍👦'],
      ['a flag', '🇯🇵'],
      ['a Japanese character with a separate voiced mark', 'か\u3099'],
    ])('and never splits %s', (_what, character) => {
      // The 80th character is the whole one, and what follows it is cut off.
      expect(cutTitle(`${'a'.repeat(limit - 1)}${character}tail`)).toBe(`${'a'.repeat(limit - 1)}${character}`);
      // One that does not fit is left out whole.
      expect(cutTitle(`${'a'.repeat(limit)}${character}`)).toBe('a'.repeat(limit));
      // A title made of them is 80 of them, not 80 code points, and one of 80 is not cut.
      expect(cutTitle(character.repeat(limit + 20))).toBe(character.repeat(limit));
      expect(cutTitle(character.repeat(limit))).toBe(character.repeat(limit));
    });
  });

  it('is "New chat" for a title that is empty, only spaces, or not text', () => {
    for (const title of ['', '   \n\t ', undefined, null, 42, {}, ['x']]) expect(cutTitle(title), String(title)).toBe('New chat');
  });
});

describe('the saved chats service', () => {
  describe('list', () => {
    it("is the admin's own chats only, with the id, the title and when it was saved: no messages", async () => {
      const { service, called } = chatsWorld([savedRow('c1', 7), savedRow('c2', 8), savedRow('c3', 7, { title: 'Any complaints this week?' })]);
      const chats = await service.list(7);
      expect(chats.map((chat) => chat.documentId).sort()).toEqual(['c1', 'c3']);
      for (const chat of chats) expect(Object.keys(chat).sort()).toEqual(['documentId', 'title', 'updatedAt']);
      expect(called('findMany')[0].params.filters).toEqual({ adminUserId: { $eq: 7 } });
    });

    it('is newest first, by when each was saved last', async () => {
      const { service } = chatsWorld([
        savedRow('old', 7, { updatedAt: '2026-10-01T00:00:00.000Z' }),
        savedRow('new', 7, { updatedAt: '2026-10-05T00:00:00.000Z' }),
        savedRow('mid', 7, { updatedAt: '2026-10-03T00:00:00.000Z' }),
      ]);
      expect((await service.list(7)).map((chat) => chat.documentId)).toEqual(['new', 'mid', 'old']);
    });

    it('is at most 100 chats: the newest ones', async () => {
      const rows = Array.from({ length: 105 }, (_, index) => savedRow(`c${index}`, 7, { updatedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString() }));
      const { service, called } = chatsWorld(rows);
      const chats = await service.list(7);
      expect(SAVED_CHATS.listRows).toBe(100);
      expect(chats).toHaveLength(100);
      expect(chats[0].documentId).toBe('c104');
      expect(chats[chats.length - 1].documentId).toBe('c5');
      expect(called('findMany')[0].params.limit).toBe(100);
    });

    it('is empty for an admin with no chats', async () => {
      const { service } = chatsWorld([savedRow('c1', 8)]);
      expect(await service.list(7)).toEqual([]);
    });
  });

  describe('view', () => {
    it('opens an own chat with its messages unwrapped, every key as it was saved', async () => {
      const messages = [staffMessage('u1', 'Hi'), { id: 'a1', role: 'assistant', parts: [{ type: 'thinking', content: 'x', signature: 'sig' }, { type: 'text', content: 'Hello.' }] }];
      const { service } = chatsWorld([savedRow('c1', 7, { messages: { v: 1, messages } })]);
      const result = await service.view(7, 'c1');
      expect(result).toMatchObject({ ok: true, value: { documentId: 'c1', title: 'Which visits are waiting?' } });
      expect((result as Doc).value.messages).toEqual(messages);
    });

    it("says there is no such chat for another admin's chat, in the same words as for an ID nobody has", async () => {
      const { service } = chatsWorld([savedRow('c1', 8)]);
      const others = await service.view(7, 'c1');
      const missing = await service.view(7, 'nobody');
      expect(others).toMatchObject({ ok: false, code: 'not_found', message: NO_CHAT });
      expect(missing).toEqual(others);
    });

    it('opens a chat whose stored messages cannot be read as an empty chat, and logs which one, without its content', async () => {
      const { service, strapi } = chatsWorld([savedRow('c1', 7, { messages: { v: 9, secret: 'line:Uabc' } })]);
      const result = await service.view(7, 'c1');
      expect(result).toMatchObject({ ok: true, value: { documentId: 'c1', messages: [] } });
      expect(strapi.log.warn).toHaveBeenCalledOnce();
      expect(strapi.log.warn.mock.calls[0][0]).toContain('c1');
      expect(strapi.log.warn.mock.calls[0][0]).not.toContain('line:Uabc');
    });
  });

  describe('create', () => {
    it('saves the chat for the admin: the envelope, the title, and the admin of the session', async () => {
      const { service, rows } = chatsWorld();
      const result = await service.create(7, { title: 'Which visits are waiting?', messages: CHAT });
      expect(result).toMatchObject({ ok: true, value: { documentId: 'chat-1', title: 'Which visits are waiting?' } });
      expect(rows.get('chat-1')).toMatchObject({ adminUserId: 7, title: 'Which visits are waiting?', messages: { v: 1, messages: CHAT } });
    });

    it('answers the row the sidebar lists, without the messages', async () => {
      const { service } = chatsWorld();
      const result = await service.create(7, { title: 'x', messages: CHAT });
      expect(Object.keys((result as Doc).value).sort()).toEqual(['documentId', 'title', 'updatedAt']);
    });

    it('cuts the title to 80 characters, and gives "New chat" for none', async () => {
      const { service, rows } = chatsWorld();
      await service.create(7, { title: 'x'.repeat(300), messages: CHAT });
      await service.create(7, { messages: CHAT });
      expect(rows.get('chat-1')?.title).toBe('x'.repeat(80));
      expect(rows.get('chat-2')?.title).toBe('New chat');
    });

    it('takes no admin from the input: a chat is always the signed-in admin\'s', async () => {
      const { service, rows } = chatsWorld();
      await service.create(7, { title: 'x', messages: CHAT, adminUserId: 99 } as never);
      expect(rows.get('chat-1')?.adminUserId).toBe(7);
    });

    it('refuses messages that are not in the shape the page keeps, and saves nothing', async () => {
      const { service, called } = chatsWorld();
      for (const messages of [undefined, 'hello', [{ id: 'm1', role: 'wizard', parts: [] }]]) {
        expect(await service.create(7, { title: 'x', messages }), JSON.stringify(messages)).toMatchObject({ ok: false, code: 'invalid_input', message: NOT_SAVED });
      }
      expect(called('create')).toEqual([]);
    });
  });

  describe('update', () => {
    it('saves the messages again, and moves the chat to the top of the list', async () => {
      const { service, rows } = chatsWorld([savedRow('c1', 7, { updatedAt: '2026-10-01T00:00:00.000Z' }), savedRow('c2', 7, { updatedAt: '2026-10-02T00:00:00.000Z' })]);
      const longer = [...CHAT, staffMessage('u2', 'And the questions?'), assistantMessage('a2', 'Three.')];
      const result = await service.update(7, 'c1', { messages: longer });
      expect(result).toMatchObject({ ok: true, value: { documentId: 'c1' } });
      expect(rows.get('c1')?.messages).toEqual({ v: 1, messages: longer });
      expect((await service.list(7)).map((chat) => chat.documentId)).toEqual(['c1', 'c2']);
    });

    it('changes only what it is given: a title alone leaves the messages, and messages alone leave the title', async () => {
      const { service, rows } = chatsWorld([savedRow('c1', 7)]);
      await service.update(7, 'c1', { title: 'A new title' });
      expect(rows.get('c1')).toMatchObject({ title: 'A new title', messages: { v: 1, messages: CHAT } });
      await service.update(7, 'c1', { messages: [staffMessage('u9', 'Other')] });
      expect(rows.get('c1')).toMatchObject({ title: 'A new title', messages: { v: 1, messages: [staffMessage('u9', 'Other')] } });
    });

    it('cuts the title to 80 characters', async () => {
      const { service, rows } = chatsWorld([savedRow('c1', 7)]);
      await service.update(7, 'c1', { title: 'y'.repeat(200) });
      expect(rows.get('c1')?.title).toBe('y'.repeat(80));
    });

    it("writes nothing for another admin's chat, or an ID nobody has, and says there is no such chat", async () => {
      const { service, called, rows } = chatsWorld([savedRow('c1', 8)]);
      expect(await service.update(7, 'c1', { title: 'Mine now' })).toMatchObject({ ok: false, code: 'not_found', message: NO_CHAT });
      expect(await service.update(7, 'nobody', { title: 'x' })).toMatchObject({ ok: false, code: 'not_found', message: NO_CHAT });
      expect(called('update')).toEqual([]);
      expect(rows.get('c1')?.title).toBe('Which visits are waiting?');
    });

    it('refuses messages that are not in the shape the page keeps, and changes nothing, the title included', async () => {
      const { service, called, rows } = chatsWorld([savedRow('c1', 7)]);
      expect(await service.update(7, 'c1', { title: 'New title', messages: 'hello' })).toMatchObject({ ok: false, code: 'invalid_input', message: NOT_SAVED });
      expect(called('update')).toEqual([]);
      expect(rows.get('c1')?.title).toBe('Which visits are waiting?');
    });

    // "New chat" is the title of a chat saved the first time, with no title to go by. A save of a chat that is already there never makes one up: a
    // body with nothing to save, or a title that is not text, is a mistake of the page, and it must not move the chat to the top or rename it.
    describe('a body with nothing to save, or a title that is not text', () => {
      const REFUSED = { ok: false, code: 'invalid_input', message: NOT_SAVED, hint: 'Start a new chat and try again.' };

      it.each([
        ['no title and no messages', {}],
        ['a title that is null', { title: null }],
        ['a title that is a number', { title: 42 }],
        ['a title that is an object', { title: {} }],
        ['a title that is a list', { title: ['x'] }],
        ['a title with no words', { title: '' }],
        ['a title of only spaces and line breaks', { title: ' \n\t ' }],
      ])('refuses %s, and writes nothing', async (_what, input) => {
        const { service, called, rows } = chatsWorld([savedRow('c1', 7)]);
        expect(await service.update(7, 'c1', input as never)).toEqual(REFUSED);
        expect(called('update')).toEqual([]);
        expect(rows.get('c1')).toEqual(savedRow('c1', 7));
      });

      it('refuses a title that is not text even when the messages are good, and saves neither', async () => {
        const { service, called, rows } = chatsWorld([savedRow('c1', 7)]);
        expect(await service.update(7, 'c1', { title: null, messages: [...CHAT, staffMessage('u2', 'More')] } as never)).toEqual(REFUSED);
        expect(called('update')).toEqual([]);
        expect(rows.get('c1')).toEqual(savedRow('c1', 7));
      });

      it("is still a 404 for another admin's chat and for an ID nobody has, whatever the body holds", async () => {
        const { service, called } = chatsWorld([savedRow('c1', 8)]);
        const theirs = await service.update(7, 'c1', {});
        expect(theirs).toMatchObject({ ok: false, code: 'not_found', message: NO_CHAT });
        expect(await service.update(7, 'nobody', {})).toEqual(theirs);
        expect(called('update')).toEqual([]);
      });
    });

    it('takes no admin from the input', async () => {
      const { service, rows } = chatsWorld([savedRow('c1', 7)]);
      await service.update(7, 'c1', { title: 'x', adminUserId: 99 } as never);
      expect(rows.get('c1')?.adminUserId).toBe(7);
    });

    // Another tab, or Reset demo activity, can delete the chat after the check read it and before the save. Strapi's update answers null then,
    // and the page saves the chat again as a new one when it is told there is no such chat.
    it('says there is no such chat, in the same words as for an ID nobody has, when the chat is deleted between the check and the save', async () => {
      const { service, rows, strapi } = chatsWorld([savedRow('c1', 7)]);
      const documents = strapi.documents;
      strapi.documents = (uid: string) => {
        const real = documents(uid);
        return {
          ...real,
          findFirst: async (params: Doc) => {
            const found = await real.findFirst(params);
            rows.delete('c1');
            return found;
          },
        };
      };
      const answer = await service.update(7, 'c1', { title: 'Late' });
      expect(answer).toMatchObject({ ok: false, code: 'not_found', message: NO_CHAT });
      expect(answer).toEqual(await service.update(7, 'nobody', { title: 'Late' }));
      expect(rows.has('c1')).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes an own chat', async () => {
      const { service, rows } = chatsWorld([savedRow('c1', 7), savedRow('c2', 7)]);
      expect(await service.remove(7, 'c1')).toEqual({ ok: true, value: { documentId: 'c1' } });
      expect([...rows.keys()]).toEqual(['c2']);
    });

    it("deletes nothing of another admin's chat, and says there is no such chat", async () => {
      const { service, called, rows } = chatsWorld([savedRow('c1', 8)]);
      expect(await service.remove(7, 'c1')).toMatchObject({ ok: false, code: 'not_found', message: NO_CHAT });
      expect(await service.remove(7, 'nobody')).toMatchObject({ ok: false, code: 'not_found' });
      expect(called('delete')).toEqual([]);
      expect(rows.has('c1')).toBe(true);
    });
  });

  // The owner check is one query on the ID and the admin together. A chat of someone else and an ID nobody has then take the same path and
  // cost the same work, and update and remove never read the stored messages, which can be up to 1 MB.
  describe('the owner check', () => {
    const asks: Record<string, { run: (service: Doc) => Promise<unknown>; fields: string[] | undefined }> = {
      view: { run: (service) => service.view(7, 'c1'), fields: undefined },
      update: { run: (service) => service.update(7, 'c1', { title: 'New title' }), fields: ['documentId'] },
      remove: { run: (service) => service.remove(7, 'c1'), fields: ['documentId'] },
    };
    const shape = (calls: Doc[]) => calls.map(({ method, params }) => ({ method, fields: params.fields, filters: Object.keys(params.filters ?? {}) }));

    it.each(Object.keys(asks))('%s asks for the chat once, on its ID and its admin together, and reads nothing else first', async (method) => {
      const { service, calls } = chatsWorld([savedRow('c1', 7)]);
      await asks[method].run(service);
      const reads = calls.filter((call) => call.method.startsWith('find'));
      expect(reads.map((call) => call.method)).toEqual(['findFirst']);
      expect(reads[0].params.filters).toEqual({ documentId: { $eq: 'c1' }, adminUserId: { $eq: 7 } });
    });

    it('is a read of the whole chat for view, and of only its ID for update and remove', async () => {
      for (const [method, { run, fields }] of Object.entries(asks)) {
        const { service, calls } = chatsWorld([savedRow('c1', 7)]);
        await run(service);
        expect(calls.find((call) => call.method === 'findFirst')?.params.fields, method).toEqual(fields);
      }
    });

    it.each(Object.keys(asks))("%s takes the same path for another admin's chat as for an ID nobody has", async (method) => {
      const theirs = chatsWorld([savedRow('c1', 8)]);
      const nobody = chatsWorld();
      const answers = [await asks[method].run(theirs.service), await asks[method].run(nobody.service)];
      expect(answers[0]).toEqual(answers[1]);
      expect(shape(theirs.calls)).toEqual(shape(nobody.calls));
      expect(shape(theirs.calls)).toEqual([{ method: 'findFirst', fields: asks[method].fields, filters: ['documentId', 'adminUserId'] }]);
    });
  });

  it('works on the conversation content type, plugin::maison.conversation', () => {
    expect(UID.conversation).toBe('plugin::maison.conversation');
  });
});

describe('the saved chats controller', () => {
  it('lists the signed-in admin\'s chats as { conversations }', async () => {
    const { controller } = chatsWorld([savedRow('c1', 7), savedRow('c2', 8)]);
    const ctx = fakeCtx({ admin: 7 });
    await controller.list(ctx);
    expect(ctx.body).toEqual({ conversations: [{ documentId: 'c1', title: 'Which visits are waiting?', updatedAt: '2026-10-06T00:00:00.000Z' }] });
  });

  it('opens a chat as { conversation }, with its messages', async () => {
    const { controller } = chatsWorld([savedRow('c1', 7)]);
    const ctx = fakeCtx({ admin: 7, params: { documentId: 'c1' } });
    await controller.findOne(ctx);
    expect(ctx.body.conversation).toMatchObject({ documentId: 'c1', title: 'Which visits are waiting?', messages: CHAT });
  });

  it('saves a new chat with 201, the admin of the session, and the row without its messages', async () => {
    const { controller, rows } = chatsWorld();
    const ctx = fakeCtx({ admin: 7, body: { title: 'Which visits are waiting?', messages: CHAT, adminUserId: 99 } });
    await controller.create(ctx);
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ conversation: { documentId: 'chat-1', title: 'Which visits are waiting?', updatedAt: expect.any(String) } });
    expect(rows.get('chat-1')?.adminUserId).toBe(7);
  });

  it('saves a chat again with 200', async () => {
    const { controller, rows } = chatsWorld([savedRow('c1', 7)]);
    const ctx = fakeCtx({ admin: 7, params: { documentId: 'c1' }, body: { messages: [...CHAT, staffMessage('u2', 'More')] } });
    await controller.update(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body.conversation.documentId).toBe('c1');
    expect(rows.get('c1')?.messages.messages).toHaveLength(3);
  });

  it('deletes a chat and says which', async () => {
    const { controller, rows } = chatsWorld([savedRow('c1', 7)]);
    const ctx = fakeCtx({ admin: 7, params: { documentId: 'c1' } });
    await controller.remove(ctx);
    expect(ctx.body).toEqual({ documentId: 'c1' });
    expect(rows.size).toBe(0);
  });

  describe("another admin's chat", () => {
    const attempt = async (handler: 'findOne' | 'update' | 'remove', params: Doc) => {
      const { controller, rows } = chatsWorld([savedRow('c1', 8)]);
      const ctx = fakeCtx({ admin: 7, params, body: { title: 'x' } });
      await controller[handler](ctx);
      return { ctx, rows };
    };

    it.each(['findOne', 'update', 'remove'] as const)('is a 404 for %s, with the code not_found, and the same answer as for an ID nobody has', async (handler) => {
      const others = await attempt(handler, { documentId: 'c1' });
      const missing = await attempt(handler, { documentId: 'nobody' });
      expect(others.ctx.status).toBe(404);
      expect(others.ctx.body).toEqual({ error: { message: NO_CHAT, details: { code: 'not_found', hint: 'Reload the page: it may have been deleted.' } } });
      expect(missing.ctx.body).toEqual(others.ctx.body);
      expect(others.rows.get('c1')).toMatchObject({ adminUserId: 8, title: 'Which visits are waiting?' });
    });
  });

  describe('a body that cannot be saved', () => {
    it.each([['undefined', undefined], ['text', 'hello'], ['a list', []], ['no messages', { title: 'x' }], ['messages in the wrong shape', { messages: [{ id: 'm1', role: 'wizard', parts: [] }] }]])(
      'is a 400 with a staff text for create: %s',
      async (_what, body) => {
        const { controller, rows } = chatsWorld();
        const ctx = fakeCtx({ admin: 7, body });
        await controller.create(ctx);
        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: { message: NOT_SAVED, details: { code: 'invalid_input', hint: 'Start a new chat and try again.' } } });
        expect(rows.size).toBe(0);
      }
    );

    it('is a 400 for update, and writes nothing', async () => {
      const { controller, called } = chatsWorld([savedRow('c1', 7)]);
      const ctx = fakeCtx({ admin: 7, params: { documentId: 'c1' }, body: { messages: 'hello' } });
      await controller.update(ctx);
      expect(ctx.status).toBe(400);
      expect(called('update')).toEqual([]);
    });

    it.each([['undefined', undefined], ['text', 'hello'], ['a list', []], ['an empty object', {}], ['a title that is null', { title: null }], ['a title that is a number', { title: 42 }]])(
      'is a 400 for update with nothing to save or a title that is not text: %s, and the chat is not changed',
      async (_what, body) => {
        const { controller, called, rows } = chatsWorld([savedRow('c1', 7)]);
        const ctx = fakeCtx({ admin: 7, params: { documentId: 'c1' }, body });
        await controller.update(ctx);
        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: { message: NOT_SAVED, details: { code: 'invalid_input', hint: 'Start a new chat and try again.' } } });
        expect(called('update')).toEqual([]);
        expect(rows.get('c1')).toEqual(savedRow('c1', 7));
      }
    );
  });

  describe('a request with no signed-in admin', () => {
    it.each(['list', 'findOne', 'create', 'update', 'remove'] as const)('is a 401 for %s, and reaches no chat', async (handler) => {
      const { controller, called } = chatsWorld([savedRow('c1', 7)]);
      const ctx = fakeCtx({ admin: null, params: { documentId: 'c1' }, body: { title: 'x', messages: CHAT } });
      await controller[handler](ctx);
      expect(ctx.unauthorized).toHaveBeenCalledOnce();
      expect(ctx.status).toBe(401);
      expect(called('findMany') ?? []).toEqual([]);
      expect(called('create')).toEqual([]);
      expect(called('update')).toEqual([]);
      expect(called('delete')).toEqual([]);
    });

    it('is a 401 for an id that is not a number: only a real admin session counts', async () => {
      const { controller } = chatsWorld([savedRow('c1', 7)]);
      const ctx = fakeCtx({ admin: null });
      ctx.state = { user: { id: '7' } };
      await controller.list(ctx);
      expect(ctx.status).toBe(401);
    });
  });
});

describe('the saved chats routes', () => {
  const gate = (action: string) => ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: [action] } }];
  const routeOf = (method: string, path: string) => routes.admin.routes.find((route) => route.method === method && route.path === path);

  it.each([
    ['GET', '/conversations', 'conversations.list'],
    ['POST', '/conversations', 'conversations.create'],
    ['GET', '/conversations/:documentId', 'conversations.findOne'],
    ['PUT', '/conversations/:documentId', 'conversations.update'],
    ['DELETE', '/conversations/:documentId', 'conversations.remove'],
  ])('send %s %s to %s, for admins who hold the assistant permission', (method, path, handler) => {
    expect(routeOf(method, path)).toEqual({ method, path, handler, config: { policies: gate(ACTION.assistantUse) } });
  });

  it('are five, and all of them need the assistant permission and nothing less', () => {
    const chats = routes.admin.routes.filter((route) => route.path.startsWith('/conversations'));
    expect(chats).toHaveLength(5);
    for (const route of chats) expect(route.config.policies, `${route.method} ${route.path}`).toEqual(gate('plugin::maison.assistant.use'));
  });

  it('name controller actions that exist', () => {
    const instance = (controllers as Doc).conversations({ strapi: fakeStrapi() });
    for (const action of ['list', 'findOne', 'create', 'update', 'remove']) expect(typeof instance[action], action).toBe('function');
  });
});
