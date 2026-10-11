import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { STARTERS } from '../../admin/src/assistant';
import { CHAT_WIDTH, HISTORY_WIDTH, MAX_DRAWER_WIDTH, drawerWidthOf } from '../../admin/src/components/assistant/drawerWidth';
import { PAGE_SUBTITLE, selectTab } from '../../admin/src/tabs';
import bootstrap from '../../server/src/bootstrap';
import { defaultConfig } from '../../server/src/config';
import { DEFAULT_MODEL } from '../../server/src/ai/provider';
import { READ_TOOL_NAMES, TOOL_LABELS } from '../../server/src/assistant/tools';
import {
  ACTION,
  ASSISTANT_LIMITS,
  KNOWLEDGE_CATEGORIES,
  LABEL_BATCH,
  MAX_LABEL_ATTEMPTS,
  MAX_OPEN_QUESTIONS,
  SAVED_CHATS,
  TOOL_NAMES,
  UID,
} from '../../server/src/constants';
import { PROMPT_VERSION } from '../../server/src/domain/inquiry-criteria';
import { registerMcp } from '../../server/src/mcp';
import routes from '../../server/src/routes';
import content from '../../server/seed/content.json';
import knowledge from '../../server/seed/knowledge.json';
import { fakeMcp, fakeStrapi } from './fake-strapi';

/**
 * The README says what the code does. These hold the facts that are written twice (the tools, the routes, the permissions, the settings, the
 * limits, the widths, the quick questions, the versions and the seed counts) to the code that has them, so a change to one that forgets the
 * other fails here. The first half is about the section on the assistant drawer. The second half is about the reference tables.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const readme = read('../../README.md');
const pkg = JSON.parse(read('../../package.json')) as { dependencies: Record<string, string> };
const start = readme.indexOf('## The assistant drawer');
const section = readme.slice(start, readme.indexOf('## The Homepage widgets'));
/** The part of the section that is about how the drawer looks and works, and not about the server. */
const screen = section.slice(section.indexOf('### The screen'), section.indexOf('### Saved chats'));

describe("the README's section on the assistant drawer", () => {
  it('is there, between the admin page and the Homepage widgets', () => {
    expect(start).toBeGreaterThan(readme.indexOf('## The admin page'));
    expect(section.length).toBeGreaterThan(2000);
    for (const heading of ['### How it is mounted', '### The screen', '### Saved chats', '### Tools', '### What the model sees', '### Limits and errors', '### Routes', '### Checking it in the browser']) {
      expect(section, heading).toContain(heading);
    }
  });

  it('names every read tool with its label, in the table of tools', () => {
    for (const name of READ_TOOL_NAMES) expect(section, name).toContain(`| \`${name}\` |`);
    for (const label of Object.values(TOOL_LABELS)) expect(section, label).toContain(`| ${label} |`);
  });

  it('names the permission and the settings, and the default model', () => {
    expect(section).toContain(`"Use the Maison assistant" (\`${ACTION.assistantUse}\`)`);
    expect(section).toContain(`\`aiChatModel\` (\`AI_CHAT_MODEL\`), \`${defaultConfig.aiChatModel}\` by default`);
    expect(section).toContain('`AI_API_KEY`');
  });

  it("says an admin with the assistant permission and none that shows Maison's menu link has no drawer", () => {
    expect(section).toContain('has no menu link, and so no drawer');
  });

  it('lists every route of the assistant and of the saved chats, as the server serves them', () => {
    const served = routes.admin.routes.filter((route) => route.handler.startsWith('assistant.') || route.handler.startsWith('conversations.'));
    expect(served).toHaveLength(7);
    for (const { method, path } of served) expect(section, `${method} ${path}`).toContain(`\`${method} ${path}\``);
  });

  it('gives the limits as the code has them', () => {
    expect(section).toContain(`| Messages from you in one chat | ${ASSISTANT_LIMITS.staffMessages}. The ${ASSISTANT_LIMITS.staffMessages + 1}st is refused`);
    expect(section).toContain(`| Model turns for one answer | ${ASSISTANT_LIMITS.modelTurns}. After that, "The assistant stopped after ${ASSISTANT_LIMITS.modelTurns} steps.`);
    expect(section).toContain(`| Time for one answer | ${ASSISTANT_LIMITS.deadlineMs / 1000} seconds |`);
    expect(section).toContain(`| Output of one model turn | ${ASSISTANT_LIMITS.maxTokens.toLocaleString('en-US')} tokens`);
    expect(section).toContain(`A list answer has at most ${ASSISTANT_LIMITS.listRows} rows`);
    expect(section).toContain(`cut to ${ASSISTANT_LIMITS.listTextChars} characters`);
    expect(section).toContain(`at most ${SAVED_CHATS.listRows}`);
    expect(section).toContain(`cut to ${SAVED_CHATS.titleChars} characters`);
  });

  it('has no em dash and no en dash, and the README has none either', () => {
    expect(section).not.toMatch(/[\u2013\u2014]/);
    expect(readme).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("the README's description of the drawer", () => {
  it('gives the widths as the code has them: the chat, Expand, the list of saved chats, what the list adds to the drawer, and the limit', () => {
    expect(screen).toContain(`${CHAT_WIDTH.narrow}px`);
    expect(screen).toContain(`${CHAT_WIDTH.wide}px`);
    expect(screen).toContain(`${HISTORY_WIDTH}px`);
    expect(screen).toContain(`${drawerWidthOf({ expanded: false, historyOpen: true })}px`);
    expect(screen).toContain(`${drawerWidthOf({ expanded: true, historyOpen: true })}px`);
    // The README says 90vw. The code holds the width 1px under that, so the border is inside the 90vw.
    expect(MAX_DRAWER_WIDTH).toBe('calc(90vw - 1px)');
    expect(screen).toContain('90vw');
  });

  it('has none of the widths of the first build, 480px and 760px, and says the list is never drawn over the messages', () => {
    expect(section).not.toContain('480px');
    expect(section).not.toContain('760px');
    expect(section).not.toMatch(/History[^.]*over the messages/);
    expect(screen).toContain('never drawn over the messages');
  });

  it('says what Expand and History each do: Expand makes the chat wider and opens no list, and History makes the drawer wider and takes nothing from the chat', () => {
    expect(screen).toMatch(/Expand the assistant[^.]*widens the chat/);
    expect(screen).toMatch(/Expand[^.]*never opens the list/);
    expect(screen).toMatch(/History[^.]*wider[^.]*chat keeps its width/);
  });

  it('names the five quick questions as the code has them, in order, and says they stay for the whole chat', () => {
    expect(STARTERS).toHaveLength(5);
    let at = -1;
    for (const question of STARTERS) {
      const found = screen.indexOf(`"${question}"`);
      expect(found, question).toBeGreaterThan(at);
      at = found;
    }
    expect(screen).toMatch(/quick questions/i);
    expect(screen).toMatch(/for the whole chat/);
    expect(section).not.toMatch(/three suggestions/);
  });

  it('says what the tables do: header cells on one line, body cells wrapping between words, 7rem to 22rem, and a sideways scroll inside the bubble', () => {
    expect(screen).toMatch(/header cells stay on one line/i);
    expect(screen).toMatch(/between words/);
    expect(screen).toContain('7rem');
    expect(screen).toContain('22rem');
    expect(screen).toMatch(/scrolls sideways inside (its|the) bubble/);
  });

  // In a real browser a table that is made to fit the bubble breaks `2026-10-05` after its second hyphen, so the README says the table is never made to fit,
  // and that the admin's rem is 10px, which is what the 7rem and the 22rem come to there.
  it('says a table is never squeezed to fit the bubble, and what 7rem and 22rem come to in the admin', () => {
    expect(screen).toMatch(/never squeezed to fit the bubble/);
    expect(screen).toContain('70px to 220px');
  });

  it('says only the message list scrolls up and down, and that opening the drawer never starts a chat', () => {
    expect(screen).toMatch(/Only the message list scrolls up and down/);
    expect(section).toMatch(/never starts a chat|Opening the drawer never starts a chat/);
  });

  it('names the files of Strapi that the mount depends on, the version it was checked on, and says what the cost of it is', () => {
    expect(section).toContain('MaisonMenuIcon');
    expect(section).toContain('assistantHost.tsx');
    expect(section).toContain('menuIconOwner.ts');
    expect(section).toContain('components/MainNav/MainNavLinks.mjs');
    expect(section).toContain('components/LeftMenu.mjs');
    expect(section).toContain('Strapi 5.57.0 draws its menu');
    expect(section).toMatch(/A Strapi upgrade can need a fix here/);
  });

  it('says the round button needs a window 1080px wide, as Strapi draws the menu link only in its mobile menu below that', () => {
    expect(section).toContain('1080px');
  });
});

describe("the README's checklist for the browser", () => {
  // The last part of the section, up to the next section of the README.
  const checklist = section.slice(section.indexOf('### Checking it in the browser'));

  it('covers the drawer on a Content Manager page and on the Maison page, and Reply on LINE above the drawer', () => {
    expect(checklist).toContain('Content Manager');
    expect(checklist).toContain('Maison page');
    expect(checklist).toContain('Reply on LINE');
  });

  it('covers that the page stays usable, Escape and the focus, Expand and History, the quick questions, the tables and the scrolling', () => {
    for (const subject of ['clickable', 'Escape', 'focus', 'Expand', 'History', 'quick questions', 'table', 'scroll']) expect(checklist.toLowerCase(), subject).toContain(subject.toLowerCase());
  });

  it('covers that opening the drawer again shows the same chat, light and dark, and the compact header', () => {
    expect(checklist).toMatch(/same chat/);
    expect(checklist).toMatch(/dark/);
    expect(checklist).toMatch(/compact header/);
  });
});

describe('the README outside that section', () => {
  it('lists aiChatModel in the configuration table, with its default', () => {
    expect(readme).toContain(`| \`aiChatModel\` | \`${defaultConfig.aiChatModel}\` |`);
  });

  it('says the admin page has three tabs and the assistant is not one, and that Reset demo activity deletes the saved chats', () => {
    expect(readme).toContain('It has up to three tabs');
    expect(readme).toContain("every admin's saved assistant chats");
    expect(readme).not.toContain('four tabs');
    expect(readme).not.toContain('saved Ask chats');
  });

  it('says an address with ?tab=ask opens the first tab, as the page does', () => {
    expect(selectTab(['requests', 'questions', 'inquiries'], 'ask')).toBe('requests');
    expect(readme).toContain('`?tab=ask`');
    expect(readme).toContain('opens the first tab');
  });

  it('describes the compact header of the Maison page: the title and the subtitle on one row, in the page the README describes', () => {
    expect(readme).toContain('The title and its subtitle share one row at the top');
    expect(PAGE_SUBTITLE.length).toBeGreaterThan(0);
  });
});

describe("the README's account of saved chats and the routes", () => {
  it('says who can read a saved chat: each admin sees their own, and a Super Admin can read all through the Content Manager API', () => {
    expect(readme).not.toContain('only they can read them');
    expect(readme).toContain('each admin sees only their own chats');
    expect(readme).toContain("Super Admin can read every saved chat through Strapi's Content Manager API");
  });

  it('says the History list shows the newest chats, as many as the code lists', () => {
    expect(SAVED_CHATS.listRows).toBe(100);
    expect(section).toContain('It shows the newest 100 chats.');
  });

  it('says a PUT with an empty body, or a title that is not text or has no words, answers 400', () => {
    expect(section).toContain('So does a `PUT` with an empty body, and a `PUT` whose `title` is not text or has no words.');
  });

  it('puts the check of a role with no tools, Tools (0), in the checklist for the browser', () => {
    expect(section).toContain('**Tools (0)**');
    expect(section).toContain('"Use the Maison assistant" and "Load and reset demo data" and nothing else');
  });

  it('says where the chats are stored, and keeps the tests out of the routes section', () => {
    expect(section).toContain('**Where it is stored:**');
    const routesText = section.slice(section.indexOf('### Routes'), section.indexOf('### Checking it in the browser'));
    expect(routesText).not.toContain('tests never reach');
    expect(section).toContain(`\`${UID.conversation}\``);
  });

  it('names each TanStack AI package with the exact version package.json pins', () => {
    for (const name of ['@tanstack/ai', '@tanstack/ai-anthropic', '@tanstack/ai-react', '@tanstack/ai-client', '@tanstack/ai-ollama']) {
      const version = pkg.dependencies[name];
      expect(version, `${name} is pinned`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(section, name).toContain(`\`${name}\` ${version}`);
    }
  });
});

/** What bootstrap registers as admin permissions: the display name and the full action of each. */
const registeredPermissions = async () => {
  const registerMany = vi.fn();
  const strapi = {
    ...fakeStrapi({ config: { liffUrl: 'http://localhost:3004' } }),
    service: () => ({ actionProvider: { registerMany } }),
    server: { use: vi.fn() },
  };
  await bootstrap({ strapi } as any);
  const actions = registerMany.mock.calls[0][0] as Array<{ uid: string; displayName: string }>;
  return actions.map(({ uid, displayName }) => ({ displayName, action: `plugin::maison.${uid}` }));
};

describe("the README's tables of tools and permissions", () => {
  it('lists the 13 permissions that bootstrap registers, each with its name and its action', async () => {
    const permissions = await registeredPermissions();
    expect(permissions).toHaveLength(13);
    expect(permissions.map((permission) => permission.action).sort()).toEqual(Object.values(ACTION).sort());
    for (const { displayName, action } of permissions) expect(readme, displayName).toContain(`| ${displayName} | \`${action}\` |`);
  });

  it('lists each of the 13 tools with the permission it needs, in the order the plugin registers them', async () => {
    const permissions = await registeredPermissions();
    const mcp = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp }));
    const tools = mcp.registerTool.mock.calls.map(([tool]) => tool as { name: string; auth: { policies: Array<{ action: string }> } });
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(tools).toHaveLength(13);
    let at = -1;
    for (const tool of tools) {
      const permission = permissions.find((candidate) => candidate.action === tool.auth.policies[0].action);
      expect(permission, tool.name).toBeDefined();
      const row = `| \`${tool.name}\` | ${permission!.displayName} |`;
      const found = readme.indexOf(row);
      expect(found, row).toBeGreaterThan(at);
      at = found;
    }
  });

  it('names the prompt, with its title, and says the log line counts what was registered', () => {
    const mcp = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp }));
    const prompts = mcp.registerPrompt.mock.calls.map(([prompt]) => prompt as { name: string; title: string });
    expect(prompts.map((prompt) => prompt.name)).toEqual(['send_pending_confirmations']);
    expect(readme).toContain('`send_pending_confirmations`');
    expect(readme).toContain("Strapi's start-up log says how many tools and prompts Maison registered.");
  });

  it('says thirteen tools and one prompt', () => {
    expect(TOOL_NAMES).toHaveLength(13);
    expect(readme).toContain('**Thirteen MCP tools and one MCP prompt**');
  });
});

describe("the README's tables of routes", () => {
  it('lists every REST route, with its tool and its access', () => {
    const served = routes['content-api'].routes;
    expect(served).toHaveLength(7);
    for (const { method, path } of served) expect(readme, `${method} ${path}`).toContain(`| \`${method} /api/maison${path}\` |`);
  });

  it('lists every admin route, with the permission that guards it', async () => {
    const permissions = await registeredPermissions();
    const served = routes.admin.routes;
    expect(served.length).toBeGreaterThan(20);
    for (const route of served) {
      const policy = route.config.policies[1] as { config: { actions: string[] } };
      const action = policy.config.actions[0];
      const permission = permissions.find((candidate) => candidate.action === action);
      expect(permission, `${route.method} ${route.path}`).toBeDefined();
      expect(readme, `${route.method} ${route.path}`).toContain(`| \`${route.method} /maison${route.path}\` | ${permission!.displayName} |`);
    }
  });
});

describe("the README's configuration, content types and seed data", () => {
  it('has a row for every configuration key, and the defaults it names', () => {
    for (const key of Object.keys(defaultConfig)) expect(readme, key).toMatch(new RegExp(`^\\| \`${key}\` \\|`, 'm'));
    expect(readme).toContain(`| \`timezone\` | \`${defaultConfig.timezone}\` |`);
    expect(readme).toContain(`| \`defaultLocale\` | \`${defaultConfig.defaultLocale}\` |`);
    expect(readme).toContain(`| \`maxOpenRequestsPerCustomer\` | \`${defaultConfig.maxOpenRequestsPerCustomer}\` |`);
    expect(readme).toContain(`| \`aiProvider\` | \`${defaultConfig.aiProvider}\` |`);
    expect(readme).toContain(`| \`lineApiBaseUrl\` | \`${defaultConfig.lineApiBaseUrl}\` |`);
  });

  it('names the default labelling model of each provider, and says OpenAI is not offered', () => {
    expect(readme).toContain(`\`${DEFAULT_MODEL.anthropic}\` for \`anthropic\` and \`${DEFAULT_MODEL.ollama}\` for \`ollama\``);
    expect(readme).not.toMatch(/openai/i);
    expect(readme).not.toContain('through the AI SDK');
  });

  it('says which labelling limits the code has: ten a sweep, five attempts, and the prompt version', () => {
    expect(readme).toContain(`labels up to ${LABEL_BATCH} inquiries`);
    expect(readme).toContain(`At ${MAX_LABEL_ATTEMPTS} attempts`);
    expect(readme).toContain(`\`${PROMPT_VERSION}\``);
    expect(readme).toContain(`Five questions can wait for one customer at a time`);
    expect(MAX_OPEN_QUESTIONS).toBe(5);
  });

  it('lists the ten content types of the plugin with their tables, and the knowledge categories', () => {
    const uids = Object.values(UID);
    expect(uids).toHaveLength(10);
    for (const uid of uids) {
      const name = uid.replace('plugin::maison.', '');
      const schema = JSON.parse(read(`../../server/src/content-types/${name}/schema.json`)) as { collectionName: string };
      expect(readme, name).toContain(`| \`${name}\` | \`${schema.collectionName}\` |`);
    }
    for (const category of KNOWLEDGE_CATEGORIES) expect(readme, category).toContain(`\`${category}\``);
  });

  it('gives the seed counts as the seed files have them', () => {
    expect(readme).toContain(`${content.boutiques.length} boutiques, ${content.collections.length} collections, ${content.products.length} products`);
    expect(readme).toContain(`${knowledge.entries.length} product knowledge entries`);
    expect(readme).toContain(`${knowledge.entries.length} entries in English and Japanese`);
    const images = readdirSync(new URL('../../server/seed/images/', import.meta.url)).filter((name) => name.endsWith('.jpg'));
    expect(readme).toContain(`${images.length} JPEG images`);
  });
});
