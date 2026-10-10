import { describe, expect, it, vi } from 'vitest';
import bootstrap from '../../server/src/bootstrap';
import { ACTION } from '../../server/src/constants';
import { fakeStrapi } from './fake-strapi';

/*
 * The server half of the original's admin-permissions test. Its other half checks the admin panel's PERMISSIONS
 * (admin/src/permissions.ts), which the admin phase ports with the admin code.
 */

const bootstrapped = async () => {
  const registerMany = vi.fn();
  const strapi = { ...fakeStrapi(), service: () => ({ actionProvider: { registerMany } }), server: { use: vi.fn() } };
  await bootstrap({ strapi } as any);
  return registerMany;
};

/** The actions bootstrap registers with Strapi's admin permissions. */
const registeredActionList = async (): Promise<Array<Record<string, string>>> =>
  (await bootstrapped()).mock.calls.flatMap(([actions]) => actions);

/** The full action names, as plugin::maison.<uid>. */
const registeredActions = async (): Promise<string[]> =>
  (await registeredActionList()).map(({ pluginName, uid }) => `plugin::${pluginName}.${uid}`);

describe('the actions bootstrap registers', () => {
  it('are these 13, in the plugin section, each with a name staff see in the role editor', async () => {
    const actions = await registeredActionList();
    expect(actions).toHaveLength(13);
    expect(actions.map(({ uid, displayName, subCategory }) => [uid, displayName, subCategory])).toEqual([
      ['catalog.read', 'MCP: browse the catalog', 'mcp'],
      ['appointments.request', 'MCP: request and view own appointments', 'mcp'],
      ['appointments.review', 'MCP: review appointment requests', 'mcp'],
      ['appointments.confirm', 'MCP: confirm appointment requests', 'mcp'],
      ['confirmations.send', 'MCP: send appointment confirmations', 'mcp'],
      ['questions.ask', 'MCP: hand questions to staff', 'mcp'],
      ['questions.read', 'Read customer questions', 'questions'],
      ['questions.answer', 'Answer customer questions on LINE', 'questions'],
      ['inquiries.log', 'MCP: log customer inquiries', 'mcp'],
      ['inquiries.view', 'Review customer inquiries', 'inquiries'],
      ['inquiries.reply', 'Reply to customer inquiries on LINE', 'inquiries'],
      ['demo.manage', 'Load and reset demo data', 'demo'],
      ['assistant.use', 'Use the Maison assistant', 'assistant'],
    ]);
    for (const action of actions) {
      expect(action.section, action.uid).toBe('plugins');
      expect(action.pluginName, action.uid).toBe('maison');
    }
  });

  it('are exactly the actions in ACTION, which the tools and routes check', async () => {
    expect((await registeredActions()).sort()).toEqual(Object.values(ACTION).sort());
  });

  it('include the review action, which the Homepage widget and the summary route check', async () => {
    expect(await registeredActions()).toContain(ACTION.appointmentsReview);
  });

  it('include the three question actions: handing a question to staff, reading questions and answering them', async () => {
    const registered = await registeredActions();
    for (const action of [ACTION.questionsAsk, ACTION.questionsRead, ACTION.questionsAnswer]) expect(registered, action).toContain(action);
  });

  it('include the three inquiry actions: logging a turn, reviewing inquiries and replying to them on LINE', async () => {
    const registered = await registeredActions();
    for (const action of [ACTION.inquiriesLog, ACTION.inquiriesView, ACTION.inquiriesReply]) expect(registered, action).toContain(action);
  });
});

describe('the assistant action', () => {
  it('is the thirteenth action bootstrap registers, with its own sub category and the name staff see in the role editor', async () => {
    const actions = await registeredActionList();
    expect(actions).toHaveLength(13);
    expect(actions.find(({ uid }) => uid === 'assistant.use')).toEqual({
      section: 'plugins',
      pluginName: 'maison',
      uid: 'assistant.use',
      displayName: 'Use the Maison assistant',
      subCategory: 'assistant',
    });
  });

  it('is registered under the full name the routes and the page check', async () => {
    expect(await registeredActions()).toContain(ACTION.assistantUse);
  });
});
