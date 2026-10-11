// @vitest-environment jsdom
import { Crown } from '@strapi/icons';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyHost } from '../../admin/src/components/assistant/assistantHost';
import { MaisonMenuIcon } from '../../admin/src/components/assistant/MaisonMenuIcon';
import { event, assistantWorld, getsOf } from './fake-assistant-world';
import { FakeAdmin, type MenuLink } from './fake-strapi-menu';
import { renderInTheme } from './render';

/*
 * Maison's menu icon, in a stand-in for Strapi's left menu that draws the icon the way Strapi 5.57.0 does (fake-strapi-menu.tsx), over a stand-in
 * for Strapi's fetch client and for `fetch`. The icon carries the assistant onto every admin page. Three things have to hold, and each has its
 * own tests here: the chat survives a change of page, however many icons Strapi draws there is one chat, and nothing done in the chat reaches
 * the menu link. Nothing here reaches a server or a model.
 */
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
const rbac = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => client, useRBAC: () => rbac.use() }));

/** What `useRBAC` answers once it has checked: the flags of the permissions asked for. */
const checked = (canUse: boolean) => ({ isLoading: false, allowedActions: { canUse }, permissions: [], error: undefined });
/** What `useRBAC` answers before it has checked: loading, and every flag false, as in @strapi/admin's hook (hooks/useRBAC.mjs). */
const checking = { isLoading: true, allowedActions: { canUse: false }, permissions: [], error: undefined };

const Plain = (props: Record<string, unknown>) => <svg data-plain-icon="" {...props} />;
const maisonLink = (handlers?: MenuLink['handlers']): MenuLink => ({ to: '/plugins/maison', label: 'Maison', icon: MaisonMenuIcon, handlers });
const contentManager: MenuLink = { to: '/content-manager', label: 'Content Manager', icon: Plain };
const inquiriesTab: MenuLink = { to: '/plugins/maison?tab=inquiries', label: 'Maison inquiries', icon: Plain };

const launcher = () => screen.findByRole('button', { name: 'Open the Maison assistant' });
const box = () => screen.getByRole('textbox', { name: 'Chat message' }) as HTMLTextAreaElement;
const region = () => screen.getByRole('region', { name: 'Chat messages' });
const where = () => screen.getByTestId('location').textContent;
const hostElement = () => document.querySelector('[data-maison-assistant]');
const menu = () => screen.getByRole('navigation', { name: 'Main navigation' });
const goTo = (name: string) => userEvent.click(within(menu()).getByRole('link', { name }));

/** Opens the drawer with the launcher, and waits for the text box. */
const openDrawer = async () => {
  await userEvent.click(await launcher());
  return screen.findByRole('textbox', { name: 'Chat message' });
};

beforeEach(() => {
  rbac.use.mockReset();
  rbac.use.mockReturnValue(checked(true));
  assistantWorld(client);
});
afterEach(() => {
  // The host is module state, so each test removes what it made.
  cleanup();
  destroyHost();
  vi.unstubAllGlobals();
});

describe('the menu icon', () => {
  it('is the Crown, drawn exactly as Strapi passes its props, so the menu looks as it did', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    const inMenu = within(menu()).getByRole('link', { name: 'Maison' }).querySelector('svg') as SVGElement;
    const reference = renderInTheme(<Crown width="20" height="20" fill="neutral500" aria-hidden="true" focusable="false" />);
    const crown = reference.container.querySelector('svg') as SVGElement;

    expect(inMenu).not.toBeNull();
    expect(inMenu.outerHTML).toBe(crown.outerHTML);
    expect(inMenu.getAttribute('width')).toBe('20');
    expect(inMenu.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws nothing else inside the menu: the launcher and the drawer are not part of the menu link', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    const button = await launcher();
    expect(menu().contains(button)).toBe(false);
    await openDrawer();
    expect(menu().contains(screen.getByRole('complementary', { name: 'Maison assistant' }))).toBe(false);
    expect(within(menu()).getAllByRole('link')).toHaveLength(1);
  });
});

describe('who gets the assistant', () => {
  it('shows the launcher to an admin who may use the assistant', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    expect(await launcher()).toBeTruthy();
  });

  it('shows nothing, not even an element in the page, to an admin who may not, and the menu link is the Crown as before', async () => {
    rbac.use.mockReturnValue(checked(false));
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    // Long enough for the chunk of the chat to be loaded, if it were going to be.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole('button', { name: 'Open the Maison assistant' })).toBeNull();
    expect(hostElement()).toBeNull();
    expect(within(menu()).getByRole('link', { name: 'Maison' }).querySelector('svg')).not.toBeNull();
  });

  it('shows nothing while the permission is being checked, and the launcher once it says yes', async () => {
    let grant: () => void = () => {};
    rbac.use.mockImplementation(() => {
      const [granted, setGranted] = React.useState(false);
      grant = () => setGranted(true);
      return granted ? checked(true) : checking;
    });
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('button', { name: 'Open the Maison assistant' })).toBeNull();

    act(() => grant());

    expect(await launcher()).toBeTruthy();
  });

  it('removes the assistant when the role loses the permission while the page is open, and brings it back if the role gets it again', async () => {
    let setCan: (value: boolean) => void = () => {};
    rbac.use.mockImplementation(() => {
      const [can, set] = React.useState(true);
      setCan = set;
      return checked(can);
    });
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    await launcher();

    act(() => setCan(false));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open the Maison assistant' })).toBeNull());
    expect(hostElement()).toBeNull();

    act(() => setCan(true));
    expect(await launcher()).toBeTruthy();
  });
});

describe('one chat, however many icons Strapi draws', () => {
  it('draws one launcher and one drawer when the mobile menu draws the icon again beside the left menu', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    await launcher();

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('link', { name: 'Maison (mobile menu)' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Open the Maison assistant' })).toHaveLength(1);
    await openDrawer();
    expect(screen.getAllByRole('complementary', { name: 'Maison assistant' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-maison-assistant]')).toHaveLength(1);
  });

  // Two feeds would tell the host the same thing twice, and ask Strapi for the permission twice. The owner rule keeps it to one.
  it('checks the permission for one icon only: the second icon draws the Crown and no feed', async () => {
    const feeds = new Set<string>();
    rbac.use.mockImplementation(() => {
      feeds.add(React.useId());
      return checked(true);
    });
    renderInTheme(
      <IntlProvider locale="en" messages={{}}>
        <MaisonMenuIcon data-icon="first" />
        <MaisonMenuIcon data-icon="second" />
      </IntlProvider>
    );
    await launcher();

    expect(document.querySelectorAll('svg[data-icon]')).toHaveLength(2);
    expect(feeds.size).toBe(1);
  });

  it('keeps the same chat when the second icon goes: staff typed in it, and what they typed is still there', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.type(await openDrawer(), 'Which visits');

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.queryByRole('link', { name: 'Maison (mobile menu)' })).toBeNull();
    expect(box().value).toBe('Which visits');
  });

  // The oldest icon looks after the chat. When it goes, the next one takes over, and the chat is the same chat.
  it('keeps the same chat when the icon that looked after it goes and another takes over', async () => {
    const Pair = ({ showFirst }: { showFirst: boolean }) => (
      <IntlProvider locale="en" messages={{}}>
        {showFirst && <MaisonMenuIcon key="first" />}
        <MaisonMenuIcon key="second" />
      </IntlProvider>
    );
    const view = renderInTheme(<Pair showFirst />);
    await userEvent.type(await openDrawer(), 'Which visits');

    view.rerender(<Pair showFirst={false} />);

    expect(screen.getAllByRole('button', { name: /Close the assistant/ })).toHaveLength(1);
    expect(box().value).toBe('Which visits');
    expect(document.querySelectorAll('[data-maison-assistant]')).toHaveLength(1);
  });
});

describe('moving between pages', () => {
  // The guard of the tests below: they only prove something while the stand-in draws the icon again, as Strapi does.
  it('has a menu that draws every icon again on a change of address, as Strapi 5.57.0 does: the stand-in is faithful to what matters', async () => {
    let mounts = 0;
    const Counted = (props: Record<string, unknown>) => {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <svg {...props} />;
    };
    renderInTheme(<FakeAdmin links={[{ to: '/plugins/maison', label: 'Maison', icon: Counted }, contentManager]} />);
    expect(mounts).toBe(1);

    await goTo('Content Manager');
    expect(where()).toBe('/content-manager');
    expect(mounts).toBe(2);

    await goTo('Maison');
    expect(mounts).toBe(3);
  });

  it('keeps the open drawer, the chat and what staff typed when the admin goes to another page', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink(), contentManager]} />);
    await userEvent.type(await openDrawer(), 'Which visits');

    await goTo('Content Manager');

    expect(where()).toBe('/content-manager');
    expect(screen.getByRole('complementary', { name: 'Maison assistant' })).toBeTruthy();
    expect(box().value).toBe('Which visits');
    // The launcher did not come back: the drawer never closed.
    expect(screen.queryByRole('button', { name: 'Open the Maison assistant' })).toBeNull();
  });

  it('does not make the chat again: the assistant is asked about once for the whole visit', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink(), contentManager, inquiriesTab]} />);
    await openDrawer();
    await waitFor(() => expect(getsOf(client, '/maison/conversations')).toBe(1));

    await goTo('Content Manager');
    await goTo('Maison inquiries');
    await goTo('Content Manager');
    await goTo('Maison');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(getsOf(client, '/maison/assistant/status')).toBe(1);
    expect(getsOf(client, '/maison/conversations')).toBe(1);
  });

  it('keeps the chat, the answer and the width when the tab of the Maison page changes, which changes the address and draws the menu again', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink(), inquiriesTab]} path="/plugins/maison" />);
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
    await userEvent.type(box(), 'And the inquiries');

    await goTo('Maison inquiries');

    expect(where()).toBe('/plugins/maison?tab=inquiries');
    expect(box().value).toBe('And the inquiries');
    expect(screen.getByRole('button', { name: 'Collapse the assistant' })).toBeTruthy();
  });

  it('keeps the chat when the mobile menu opens and closes, which draws the menu again', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink(), contentManager]} />);
    await userEvent.type(await openDrawer(), 'Which visits');

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(box().value).toBe('Which visits');
  });

  // The permission check of an icon that is drawn again starts from "loading", with every flag false. That is not a role that lost the permission.
  it('does not remove the assistant while an icon that is drawn again checks the permission once more', async () => {
    rbac.use.mockImplementation(() => {
      const [done, setDone] = React.useState(false);
      React.useEffect(() => {
        const timer = setTimeout(() => setDone(true), 40);
        return () => clearTimeout(timer);
      }, []);
      return done ? checked(true) : checking;
    });
    renderInTheme(<FakeAdmin links={[maisonLink(), contentManager]} />);
    await userEvent.type(await openDrawer(), 'Which visits');

    await goTo('Content Manager');
    // The new icon is checking now. For a moment it says "no": the chat must not go.
    expect(screen.getByRole('complementary', { name: 'Maison assistant' })).toBeTruthy();
    expect(box().value).toBe('Which visits');
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(screen.getByRole('complementary', { name: 'Maison assistant' })).toBeTruthy();
    expect(box().value).toBe('Which visits');
  });

  // Staff ask, and then go to the page the answer is about. The answer must go on arriving.
  it('goes on with an answer that is on its way while the admin goes to another page, and shows it', async () => {
    let finish: () => void = () => {};
    const encoder = new TextEncoder();
    const send = (controller: ReadableStreamDefaultController<Uint8Array>, events: Array<Record<string, unknown>>) => {
      for (const item of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
    };
    const slow = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            send(controller, [
              event('RUN_STARTED'),
              event('TEXT_MESSAGE_START', { messageId: 'slow', role: 'assistant' }),
              event('TEXT_MESSAGE_CONTENT', { messageId: 'slow', delta: 'Looking into it' }),
            ]);
            finish = () => {
              send(controller, [event('TEXT_MESSAGE_CONTENT', { messageId: 'slow', delta: ' and found two visits.' }), event('TEXT_MESSAGE_END', { messageId: 'slow' }), event('RUN_FINISHED', { finishReason: 'stop' })]);
              controller.close();
            };
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    assistantWorld(client, { chat: [slow] });
    renderInTheme(<FakeAdmin links={[maisonLink(), contentManager]} />);
    await openDrawer();
    await userEvent.type(box(), 'Which visits are waiting?{Enter}');
    await within(region()).findByText('Looking into it');

    await goTo('Content Manager');
    await goTo('Maison');
    finish();

    expect(await within(region()).findByText('Looking into it and found two visits.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(Array.from(document.querySelectorAll('[role="alert"]')).filter((alert) => alert.textContent)).toEqual([]);
  });

  it('follows the theme when the admin switches it: the drawer is drawn again in the new colours, with the chat as it was', async () => {
    renderInTheme(<FakeAdmin links={[maisonLink()]} />);
    await userEvent.type(await openDrawer(), 'Which visits');
    const drawer = () => screen.getByRole('complementary', { name: 'Maison assistant' });
    const background = () => {
      const all = Array.from(document.querySelectorAll('style'))
        .map((style) => style.textContent ?? '')
        .join('\n');
      const classes = Array.from(drawer().classList);
      return all
        .split('}')
        .filter((rule) => classes.some((name) => rule.trimStart().startsWith(`.${name}`)))
        .join('}');
    };
    const light = background();

    await userEvent.click(screen.getByRole('button', { name: 'Switch the theme' }));

    await waitFor(() => expect(background()).not.toBe(light));
    expect(box().value).toBe('Which visits');
  });
});

describe('events stay inside the chat', () => {
  /** Every handler the menu link could have, as the spec lists them. A click or a key press in the chat must reach none of them. */
  const names = ['onClick', 'onMouseDown', 'onMouseUp', 'onPointerDown', 'onPointerUp', 'onPointerEnter', 'onPointerLeave', 'onKeyDown', 'onKeyUp', 'onFocus', 'onBlur'] as const;
  const spies = () => Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
  const reached = (handlers: ReturnType<typeof spies>) => names.filter((name) => handlers[name].mock.calls.length > 0);

  it('has spies that work: pressing the icon in the menu reaches the link, and takes the admin to the Maison page', async () => {
    const handlers = spies();
    renderInTheme(<FakeAdmin links={[maisonLink(handlers), contentManager]} path="/content-manager" />);
    await launcher();

    await userEvent.click(within(menu()).getByRole('link', { name: 'Maison' }));

    expect(handlers.onClick).toHaveBeenCalledOnce();
    expect(where()).toBe('/plugins/maison');
  });

  it('does not let a click, a pointer, a key or the focus in the drawer reach the menu link, and the admin stays on the page they are on', async () => {
    const handlers = spies();
    renderInTheme(<FakeAdmin links={[maisonLink(handlers), contentManager]} path="/content-manager" />);
    await userEvent.type(await openDrawer(), 'Which visits are waiting?');

    // Everything staff do in the chat: buttons of the top bar, the list of tools, the saved chats, the starters, the text box, and the keyboard.
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide history' }));
    await userEvent.click(screen.getByRole('button', { name: /^Tools \(/ }));
    await userEvent.keyboard('{Escape}');
    await userEvent.hover(screen.getByRole('button', { name: 'Expand the assistant' }));
    await userEvent.unhover(screen.getByRole('button', { name: 'Expand the assistant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the assistant' }));
    await userEvent.click(box());
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}more');
    await userEvent.tab();
    await userEvent.tab({ shift: true });

    expect(reached(handlers)).toEqual([]);
    expect(where()).toBe('/content-manager');
  });

  it('does not let the click on the launcher, or on Close, reach the menu link either', async () => {
    const handlers = spies();
    renderInTheme(<FakeAdmin links={[maisonLink(handlers), contentManager]} path="/content-manager" />);

    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
    await userEvent.click(await launcher());

    expect(reached(handlers)).toEqual([]);
    expect(where()).toBe('/content-manager');
  });

  it('leaves the menu link as the tooltip of the menu needs it: hovering the icon in the menu still works', async () => {
    const handlers = spies();
    renderInTheme(<FakeAdmin links={[maisonLink(handlers)]} />);
    await launcher();

    await userEvent.hover(within(menu()).getByRole('link', { name: 'Maison' }));

    expect(handlers.onPointerEnter).toHaveBeenCalled();
  });
});
