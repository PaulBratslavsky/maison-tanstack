import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../admin/src/permissions';
import bootstrap from '../../server/src/bootstrap';
import { ACTION } from '../../server/src/constants';
import { fakeStrapi } from './fake-strapi';

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

describe("the admin panel's permissions", () => {
  it("gate the Homepage widget on the server's review action, the one its summary route checks", () => {
    expect(PERMISSIONS.widget).toHaveLength(1);
    expect(PERMISSIONS.widget[0].action).toBe(ACTION.appointmentsReview);
  });

  it('name only actions the server registers', async () => {
    const registered = await registeredActions();
    expect(registered).toContain(ACTION.appointmentsReview);
    for (const { action } of Object.values(PERMISSIONS).flat()) expect(registered, action).toContain(action);
  });
});

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

describe("the admin panel's permissions for customer questions", () => {
  const actionsOf = (permissions: ReadonlyArray<{ action: string }>) => permissions.map(({ action }) => action);

  /** The flag useRBAC answers for a permission: `can` and the action's last word, each part of a hyphenated word capitalised (useRBAC.mjs). */
  const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const flagOf = ({ action }: { action: string }) => `can${capitalise(action.split('.').slice(-1)[0].split('-').map(capitalise).join(''))}`;

  it('open the page to staff who can read questions, as well as to those who review requests or manage the demo data', () => {
    expect(actionsOf(PERMISSIONS.page)).toEqual(expect.arrayContaining([ACTION.appointmentsReview, ACTION.demoManage, ACTION.questionsRead]));
  });

  it('check reading and answering questions with useRBAC, for the page to read', () => {
    expect(actionsOf(PERMISSIONS.sections)).toEqual(expect.arrayContaining([ACTION.questionsRead, ACTION.questionsAnswer]));
  });

  it('make the flags the Maison page reads: canReview, canConfirm, canManage, canRead, canAnswer, canView and canReply', () => {
    expect(PERMISSIONS.sections.map(flagOf)).toEqual(expect.arrayContaining(['canReview', 'canConfirm', 'canManage', 'canRead', 'canAnswer', 'canView', 'canReply']));
  });

  it('make a different flag for each action: actions that end in the same word would share one flag', () => {
    for (const [name, permissions] of Object.entries(PERMISSIONS)) {
      const flags = permissions.map(flagOf);
      expect(new Set(flags).size, `${name}: ${flags.join(', ')}`).toBe(flags.length);
    }
  });

  // The page checks every action of `sections` at once, so two that end in one word would give one flag for both.
  it('make seven flags for the seven actions the page checks, none of them shared', () => {
    expect(PERMISSIONS.sections).toHaveLength(7);
    expect(new Set(PERMISSIONS.sections.map(flagOf)).size).toBe(7);
  });
});

describe("the admin panel's permission for the assistant", () => {
  const actionsOf = (permissions: ReadonlyArray<{ action: string }>) => permissions.map(({ action }) => action);

  // The assistant is a drawer on every admin page, drawn by Maison's menu icon, which checks this one permission and reads canUse.
  it("is one entry of its own, checked with useRBAC by the menu icon, for the icon to read as canUse", () => {
    expect(PERMISSIONS.assistant).toEqual([{ action: ACTION.assistantUse, subject: null }]);
    expect(ACTION.assistantUse.split('.').slice(-1)[0]).toBe('use');
  });

  it("is not one of the permissions the Maison page checks: the page has no assistant of its own any more", () => {
    expect(actionsOf(PERMISSIONS.sections)).not.toContain(ACTION.assistantUse);
  });

  it("doesn't open the page on its own: the page is for staff who read something, and the assistant is on every page", () => {
    expect(actionsOf(PERMISSIONS.page)).not.toContain(ACTION.assistantUse);
  });

  it('is on no Homepage widget', () => {
    expect(actionsOf(PERMISSIONS.widget)).not.toContain(ACTION.assistantUse);
    expect(actionsOf(PERMISSIONS.inquiriesWidget)).not.toContain(ACTION.assistantUse);
  });
});

describe("the admin panel's permissions for customer inquiries", () => {
  const actionsOf = (permissions: ReadonlyArray<{ action: string }>) => permissions.map(({ action }) => action);

  it('open the page to staff who can review inquiries, as well as to those who review requests, read questions or manage the demo data', () => {
    expect(actionsOf(PERMISSIONS.page)).toEqual(
      expect.arrayContaining([ACTION.appointmentsReview, ACTION.demoManage, ACTION.questionsRead, ACTION.inquiriesView])
    );
  });

  it("don't open the page for replying alone: the buttons live in the Inquiries tab, which needs the view permission", () => {
    expect(actionsOf(PERMISSIONS.page)).not.toContain(ACTION.inquiriesReply);
  });

  it('check viewing and replying to inquiries with useRBAC, for the page to read', () => {
    expect(actionsOf(PERMISSIONS.sections)).toEqual(expect.arrayContaining([ACTION.inquiriesView, ACTION.inquiriesReply]));
  });

  it("gate the inquiries' Homepage widget on the server's view action, the one its summary route checks", () => {
    expect(PERMISSIONS.inquiriesWidget).toHaveLength(1);
    expect(PERMISSIONS.inquiriesWidget[0].action).toBe(ACTION.inquiriesView);
    expect(PERMISSIONS.inquiriesWidget[0].subject).toBeNull();
  });

  it('keep the requests widget on the review action: the inquiries have a widget of their own, not a line in it', () => {
    expect(actionsOf(PERMISSIONS.widget)).toEqual([ACTION.appointmentsReview]);
    expect(actionsOf(PERMISSIONS.widget)).not.toContain(ACTION.inquiriesView);
  });
});
