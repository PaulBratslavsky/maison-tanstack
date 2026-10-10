import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  CONVERSATION_PATHS,
  HISTORY_ERRORS,
  conversationTitle,
  createSaveQueue,
  isChatAnswer,
  isChatList,
  isSavedAnswer,
  isSavedRow,
  needsSaving,
  savedKeyOf,
  withSavedChat,
  withoutSavedChat,
  type ChatSnapshot,
  type SavedChatRow,
  type SaveQueueDeps,
} from '../../admin/src/conversations';
import routes from '../../server/src/routes';
import { SAVED_CHATS } from '../../server/src/constants';
import { cutTitle } from '../../server/src/services/conversations';

type Doc = Record<string, any>;
type Message = { id: string; role: string; parts: Doc[] };

const text = (content: string): Doc => ({ type: 'text', content });
const staff = (id: string, ...parts: Doc[]): Message => ({ id, role: 'user', parts });
const assistant = (id: string, ...parts: Doc[]): Message => ({ id, role: 'assistant', parts });
const row = (documentId: string, title = 'A chat', updatedAt = '2026-10-07T00:00:00.000Z'): SavedChatRow => ({ documentId, title, updatedAt });

describe('the saved chats paths', () => {
  // Admin routes are served at /maison<path>, so the page's paths are the server's own with that prefix.
  it("are the routes the server has, under the plugin's admin prefix", () => {
    const served = (method: string, handler: string) => {
      const found = routes.admin.routes.filter((route) => route.method === method && route.handler === handler);
      expect(found, `${method} ${handler}`).toHaveLength(1);
      return `/maison${found[0].path}`;
    };
    expect(CONVERSATION_PATHS.list).toBe(served('GET', 'conversations.list'));
    expect(CONVERSATION_PATHS.list).toBe(served('POST', 'conversations.create'));
    const one = served('GET', 'conversations.findOne');
    expect(served('PUT', 'conversations.update')).toBe(one);
    expect(served('DELETE', 'conversations.remove')).toBe(one);
    expect(CONVERSATION_PATHS.one(':documentId')).toBe(one.replace(':documentId', encodeURIComponent(':documentId')));
    expect(CONVERSATION_PATHS.one('abc123')).toBe('/maison/conversations/abc123');
  });

  it('write an ID so it stays one path segment', () => {
    expect(CONVERSATION_PATHS.one('a/b?c#d')).toBe('/maison/conversations/a%2Fb%3Fc%23d');
  });
});

describe('what the server answers', () => {
  const messages = [staff('u1', text('Hi'))];

  it('is a saved row when it has an ID, a title and a time', () => {
    expect(isSavedRow(row('c1'))).toBe(true);
    for (const value of [null, undefined, 'c1', [], {}, { documentId: 'c1', title: 'x' }, { documentId: '', title: 'x', updatedAt: 'y' }, { documentId: 1, title: 'x', updatedAt: 'y' }, { documentId: 'c1', title: 5, updatedAt: 'y' }]) {
      expect(isSavedRow(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('is a list when every one of its rows is', () => {
    expect(isChatList({ conversations: [row('c1'), row('c2')] })).toBe(true);
    expect(isChatList({ conversations: [] })).toBe(true);
    for (const value of [null, {}, { conversations: 'x' }, { conversations: [row('c1'), { documentId: 'c2' }] }, [row('c1')]]) expect(isChatList(value), JSON.stringify(value)).toBe(false);
  });

  it('is an opened chat when it has a row and its messages', () => {
    expect(isChatAnswer({ conversation: { ...row('c1'), messages } })).toBe(true);
    expect(isChatAnswer({ conversation: { ...row('c1'), messages: [] } })).toBe(true);
    for (const value of [null, {}, { conversation: row('c1') }, { conversation: { ...row('c1'), messages: 'x' } }, { conversation: { documentId: 'c1', messages } }]) expect(isChatAnswer(value), JSON.stringify(value)).toBe(false);
  });

  it('is a saved answer when it names the row', () => {
    expect(isSavedAnswer({ conversation: row('c1') })).toBe(true);
    expect(isSavedAnswer({ conversation: { documentId: 'c1' } })).toBe(false);
    expect(isSavedAnswer({})).toBe(false);
  });
});

describe('conversationTitle', () => {
  it('is the first staff message', () => {
    expect(conversationTitle([staff('u1', text('Which visits are waiting?')), assistant('a1', text('Two.')), staff('u2', text('And questions?'))])).toBe('Which visits are waiting?');
  });

  it('puts the words on one line: line breaks and runs of spaces become single spaces', () => {
    expect(conversationTitle([staff('u1', text('  Which visits\n\nare   waiting?  '))])).toBe('Which visits are waiting?');
  });

  it('is cut to 80 characters, and one of 80 is not cut', () => {
    expect(conversationTitle([staff('u1', text('a'.repeat(80)))])).toBe('a'.repeat(80));
    expect(conversationTitle([staff('u1', text('a'.repeat(81)))])).toBe('a'.repeat(80));
  });

  it('counts characters, so an emoji or a Japanese character is never split', () => {
    expect(conversationTitle([staff('u1', text('😀'.repeat(100)))])).toBe('😀'.repeat(80));
    const japanese = '今日のお客様からの問い合わせを教えてください。'.repeat(5);
    expect(Array.from(conversationTitle([staff('u1', text(japanese))]))).toHaveLength(80);
  });

  it('joins the text parts of the message, and skips the parts that are not text', () => {
    expect(conversationTitle([staff('u1', text('First'), { type: 'thinking', content: 'x' }, text('second'))])).toBe('First second');
  });

  it('is "New chat" when there is no staff message, or it has no words', () => {
    expect(conversationTitle([])).toBe('New chat');
    expect(conversationTitle([assistant('a1', text('Hello.'))])).toBe('New chat');
    expect(conversationTitle([staff('u1', text('  \n '))])).toBe('New chat');
    expect(conversationTitle([staff('u1')])).toBe('New chat');
  });

  // A character as people see it can be several code points. Counting code points would cut one of them in two.
  describe('counts characters as people see them', () => {
    const limit = SAVED_CHATS.titleChars;

    it.each([
      ['an emoji with a skin tone', '👍🏽'],
      ['a family emoji joined by zero-width joiners', '👨‍👩‍👧‍👦'],
      ['a flag', '🇯🇵'],
      ['a Japanese character with a separate voiced mark', 'か\u3099'],
    ])('and never splits %s', (_what, character) => {
      const titleOf = (title: string) => conversationTitle([staff('u1', text(title))]);
      // The 80th character is the whole one, and what follows it is cut off.
      expect(titleOf(`${'a'.repeat(limit - 1)}${character}tail`)).toBe(`${'a'.repeat(limit - 1)}${character}`);
      // One that does not fit is left out whole.
      expect(titleOf(`${'a'.repeat(limit)}${character}`)).toBe('a'.repeat(limit));
      // A title made of them is 80 of them, not 80 code points, and one of 80 is not cut.
      expect(titleOf(character.repeat(limit + 20))).toBe(character.repeat(limit));
      expect(titleOf(character.repeat(limit))).toBe(character.repeat(limit));
    });
  });

  // The page and the server each cut a title, and they are the same cut: the title staff see is the title the server keeps.
  it('is cut exactly as the server cuts a title', () => {
    expect(SAVED_CHATS.titleChars).toBe(80);
    for (const title of ['Which visits are waiting?', '  spaced \n out  ', 'x'.repeat(300), '😀'.repeat(90), `${'a'.repeat(79)}👨‍👩‍👧‍👦tail`, `${'a'.repeat(79)}🇯🇵tail`, `${'a'.repeat(79)}か\u3099tail`, '今日のお客様からの問い合わせを教えてください。'.repeat(6), '', '   ']) {
      expect(conversationTitle([staff('u1', text(title))]), JSON.stringify(title)).toBe(cutTitle(title));
    }
  });
});

describe('the list of saved chats', () => {
  it('puts a chat that was just saved at the top, once', () => {
    const list = [row('c1'), row('c2'), row('c3')];
    expect(withSavedChat(list, row('c2', 'Renamed')).map((chat) => chat.documentId)).toEqual(['c2', 'c1', 'c3']);
    expect(withSavedChat(list, row('c2', 'Renamed'))[0].title).toBe('Renamed');
    expect(withSavedChat(list, row('c9')).map((chat) => chat.documentId)).toEqual(['c9', 'c1', 'c2', 'c3']);
    expect(withSavedChat([], row('c1'))).toEqual([row('c1')]);
  });

  it('takes a deleted chat out, and leaves the list as it was for an ID that is not in it', () => {
    const list = [row('c1'), row('c2')];
    expect(withoutSavedChat(list, 'c1')).toEqual([row('c2')]);
    expect(withoutSavedChat(list, 'nobody')).toEqual(list);
  });

  it('does not change the list it was given', () => {
    const list = Object.freeze([row('c1'), row('c2')]);
    withSavedChat(list, row('c2'));
    withoutSavedChat(list, 'c1');
    expect(list).toHaveLength(2);
  });
});

describe('needsSaving', () => {
  const messages = [staff('u1', text('Hi')), assistant('a1', text('Hello.'))];

  it('is true for a chat that has messages no save has taken yet', () => {
    expect(needsSaving(messages, '')).toBe(true);
  });

  it('is false for the messages that were last saved or opened: a chat is not saved again for nothing', () => {
    expect(needsSaving(messages, savedKeyOf(messages))).toBe(false);
    expect(needsSaving([...messages], savedKeyOf(messages))).toBe(false);
  });

  it('is true again once the chat has changed, a message or only a part of one', () => {
    expect(needsSaving([...messages, staff('u2', text('More'))], savedKeyOf(messages))).toBe(true);
    expect(needsSaving([messages[0], assistant('a1', text('Hello. And more.'))], savedKeyOf(messages))).toBe(true);
  });

  it('is false for an empty chat, whatever was saved: an empty chat is never saved', () => {
    expect(needsSaving([], '')).toBe(false);
    expect(needsSaving([], savedKeyOf(messages))).toBe(false);
  });
});

describe('the save queue', () => {
  /** A promise that is settled from outside, so a test decides when a request of the queue answers. */
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  };
  const snapshot = (title: string, ...messages: Doc[]): ChatSnapshot => ({ title, messages });
  /** The queue over requests that answer at once, recording each. `create` and `update` can be replaced by a test that needs to hold one back. */
  const queueWith = (overrides: { create?: Mock<SaveQueueDeps['create']>; update?: Mock<SaveQueueDeps['update']> } = {}) => {
    let made = 0;
    const log: string[] = [];
    const deps = {
      create: vi.fn<SaveQueueDeps['create']>(async (shot) => {
        made += 1;
        log.push(`create ${shot.title}`);
        return row(`chat-${made}`, shot.title);
      }),
      update: vi.fn<SaveQueueDeps['update']>(async (documentId, shot) => {
        log.push(`update ${documentId} ${shot.title}`);
        return row(documentId, shot.title);
      }),
      onSaved: vi.fn<SaveQueueDeps['onSaved']>(),
      onError: vi.fn<SaveQueueDeps['onError']>(),
      ...overrides,
    };
    return { queue: createSaveQueue(deps), deps, log };
  };

  it('creates a new chat on its first save, and updates that chat on every later save', async () => {
    const { queue, log } = queueWith();
    expect(queue.openId()).toBeNull();
    await queue.save(snapshot('One'));
    expect(queue.openId()).toBe('chat-1');
    await queue.save(snapshot('One', staff('u1')));
    await queue.save(snapshot('One', staff('u1'), assistant('a1')));
    expect(log).toEqual(['create One', 'update chat-1 One', 'update chat-1 One']);
  });

  it('tells what each save did: created or updated, and the row', async () => {
    const { queue, deps } = queueWith();
    await queue.save(snapshot('One'));
    await queue.save(snapshot('One'));
    expect(deps.onSaved.mock.calls).toEqual([
      [row('chat-1', 'One'), { created: true, current: true }],
      [row('chat-1', 'One'), { created: false, current: true }],
    ]);
  });

  // The bug that gave strapi-plugin-tanstack-ai two identical chats in its sidebar: two saves started before the first had an ID.
  it('creates a chat once when two saves are made before the first has answered: the second waits and updates it', async () => {
    const first = deferred<SavedChatRow>();
    const { queue, deps, log } = queueWith({ create: vi.fn<SaveQueueDeps['create']>(() => first.promise) });
    const one = queue.save(snapshot('One'));
    const two = queue.save(snapshot('One', staff('u1')));
    await Promise.resolve();
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.update).not.toHaveBeenCalled();
    first.resolve(row('chat-1', 'One'));
    await Promise.all([one, two]);
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.update).toHaveBeenCalledExactlyOnceWith('chat-1', snapshot('One', staff('u1')));
    expect(log).toEqual(['update chat-1 One']);
  });

  it('runs the saves one at a time, in the order they were made', async () => {
    const gates = [deferred<SavedChatRow>(), deferred<SavedChatRow>(), deferred<SavedChatRow>()];
    const started: string[] = [];
    let call = 0;
    const { queue } = queueWith({
      create: vi.fn<SaveQueueDeps['create']>(async (shot) => {
        started.push(`create ${shot.title}`);
        return gates[call++].promise;
      }),
      update: vi.fn<SaveQueueDeps['update']>(async (_documentId, shot) => {
        started.push(`update ${shot.title}`);
        return gates[call++].promise;
      }),
    });
    const all = [queue.save(snapshot('A')), queue.save(snapshot('B')), queue.save(snapshot('C'))];
    await Promise.resolve();
    expect(started).toEqual(['create A']);
    gates[0].resolve(row('chat-1'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['create A', 'update B']);
    gates[1].resolve(row('chat-1'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    gates[2].resolve(row('chat-1'));
    await Promise.all(all);
    expect(started).toEqual(['create A', 'update B', 'update C']);
  });

  it('goes on with the next save when one fails, and tells what failed', async () => {
    const error = new Error('Strapi is down');
    const { queue, deps, log } = queueWith({
      create: vi.fn<SaveQueueDeps['create']>(async () => {
        throw error;
      }),
    });
    await queue.save(snapshot('One'));
    expect(deps.onError).toHaveBeenCalledExactlyOnceWith(error, { current: true });
    expect(queue.openId()).toBeNull();
    // The chat was never created, so the next save creates it.
    deps.create.mockImplementation(async (shot) => {
      log.push(`create ${shot.title}`);
      return row('chat-1', shot.title);
    });
    await queue.save(snapshot('One', staff('u1')));
    expect(log).toEqual(['create One']);
    expect(queue.openId()).toBe('chat-1');
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not stop later saves for a failed update, and keeps the chat it was saving', async () => {
    const { queue, deps, log } = queueWith();
    await queue.save(snapshot('One'));
    deps.update.mockRejectedValueOnce(new Error('Gateway timeout'));
    await queue.save(snapshot('One', staff('u1')));
    expect(deps.onError).toHaveBeenCalledOnce();
    expect(queue.openId()).toBe('chat-1');
    await queue.save(snapshot('One', staff('u1'), assistant('a1')));
    expect(log).toEqual(['create One', 'update chat-1 One']);
  });

  it('saves a chat again as a new chat when the chat is not there any more: deleted elsewhere, or cleared by Reset demo activity', async () => {
    const { queue, deps, log } = queueWith();
    await queue.save(snapshot('One'));
    deps.update.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    await queue.save(snapshot('One', staff('u1')));
    expect(deps.onError).not.toHaveBeenCalled();
    expect(log).toEqual(['create One', 'create One']);
    expect(queue.openId()).toBe('chat-2');
    expect(deps.onSaved).toHaveBeenLastCalledWith(row('chat-2', 'One'), { created: true, current: true, replaced: 'chat-1' });
  });

  it('reports a 404 on the create it falls back to like any other failure', async () => {
    const { queue, deps } = queueWith();
    await queue.save(snapshot('One'));
    deps.update.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    deps.create.mockRejectedValueOnce(new Error('Strapi is down'));
    await queue.save(snapshot('One', staff('u1')));
    expect(deps.onError).toHaveBeenCalledOnce();
    expect(queue.openId()).toBeNull();
  });

  it('says, when a save fails, whether its chat is still the open one', async () => {
    const gate = deferred<SavedChatRow>();
    const { queue, deps } = queueWith({ create: vi.fn<SaveQueueDeps['create']>(() => gate.promise) });
    const first = queue.save(snapshot('Old'));
    queue.switchTo(null);
    const failure = new Error('Strapi is down');
    gate.reject(failure);
    await first;
    expect(deps.onError).toHaveBeenCalledExactlyOnceWith(failure, { current: false });
  });

  describe('starting another chat', () => {
    it('does not give the new chat the ID of the chat that was being created: the create is for the chat it was made for', async () => {
      const gate = deferred<SavedChatRow>();
      const { queue, deps, log } = queueWith({ create: vi.fn<SaveQueueDeps['create']>(() => gate.promise) });
      const first = queue.save(snapshot('Old'));
      queue.switchTo(null);
      gate.resolve(row('chat-old', 'Old'));
      await first;
      expect(queue.openId()).toBeNull();
      expect(deps.onSaved).toHaveBeenCalledExactlyOnceWith(row('chat-old', 'Old'), { created: true, current: false });
      // The new chat is saved as a chat of its own.
      deps.create.mockImplementation(async (shot) => {
        log.push(`create ${shot.title}`);
        return row('chat-new', shot.title);
      });
      await queue.save(snapshot('New'));
      expect(log).toEqual(['create New']);
      expect(queue.openId()).toBe('chat-new');
    });

    it('sends a save that was made before the switch to the chat it was made for, even when it runs after it', async () => {
      const { queue, log } = queueWith();
      await queue.save(snapshot('Old'));
      const waiting = queue.save(snapshot('Old', staff('u1')));
      queue.switchTo(null);
      const next = queue.save(snapshot('New'));
      await Promise.all([waiting, next]);
      expect(log).toEqual(['create Old', 'update chat-1 Old', 'create New']);
      expect(queue.openId()).toBe('chat-2');
    });

    it('tells that an update is not for the open chat when staff moved on before it ran', async () => {
      const { queue, deps } = queueWith();
      await queue.save(snapshot('Old'));
      const waiting = queue.save(snapshot('Old', staff('u1')));
      queue.switchTo(null);
      await waiting;
      expect(deps.onSaved).toHaveBeenLastCalledWith(row('chat-1', 'Old'), { created: false, current: false });
    });

    it('updates a saved chat that is opened, from the next save on', async () => {
      const { queue, log } = queueWith();
      queue.switchTo('chat-77');
      expect(queue.openId()).toBe('chat-77');
      await queue.save(snapshot('Older', staff('u1')));
      expect(log).toEqual(['update chat-77 Older']);
    });

    it('is a new chat again after a saved one: New chat keeps the old chat and starts an empty one', async () => {
      const { queue, log } = queueWith();
      await queue.save(snapshot('One'));
      queue.switchTo(null);
      expect(queue.openId()).toBeNull();
      await queue.save(snapshot('Two'));
      expect(log).toEqual(['create One', 'create Two']);
      queue.switchTo('chat-1');
      await queue.save(snapshot('One', staff('u1')));
      expect(log.at(-1)).toBe('update chat-1 One');
    });
  });

  describe('forget', () => {
    it('makes the open chat a new one when it is the chat that was deleted: the next save creates a chat', async () => {
      const { queue, log } = queueWith();
      await queue.save(snapshot('One'));
      queue.forget('chat-1');
      expect(queue.openId()).toBeNull();
      await queue.save(snapshot('One', staff('u1')));
      expect(log).toEqual(['create One', 'create One']);
    });

    it('leaves the open chat alone when another chat was deleted', async () => {
      const { queue } = queueWith();
      queue.switchTo('chat-5');
      queue.forget('chat-9');
      expect(queue.openId()).toBe('chat-5');
    });
  });

  it('is idle when every save so far is over: a delete waits for the saves before it', async () => {
    const gate = deferred<SavedChatRow>();
    const { queue } = queueWith({ create: vi.fn<SaveQueueDeps['create']>(() => gate.promise) });
    void queue.save(snapshot('One'));
    let idle = false;
    const waiting = queue.idle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    gate.resolve(row('chat-1'));
    await waiting;
    expect(idle).toBe(true);
  });

  it('is idle at once when nothing was saved', async () => {
    await expect(queueWith().queue.idle()).resolves.toBeUndefined();
  });

  it('gives staff one text for each thing that can fail', () => {
    expect(HISTORY_ERRORS).toEqual({
      list: "Couldn't load your saved chats.",
      open: "Couldn't open that chat.",
      save: "Couldn't save this chat.",
      remove: "Couldn't delete that chat.",
    });
    for (const text of Object.values(HISTORY_ERRORS)) expect(text).not.toMatch(/\u2014|\u2013/);
  });
});
