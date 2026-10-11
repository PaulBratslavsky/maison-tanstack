// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_GRACE_MS, attachHost, destroyHost, detachHost, updateHost } from '../../admin/src/components/assistant/assistantHost';
import { assistantWorld } from './fake-assistant-world';
import './render';

/*
 * The assistant's host: the one place on the screen where the chat is kept, in a React root of its own, added to the body. The chat cannot be kept in
 * Maison's menu icon, because Strapi draws that icon again on every change of address (see fake-strapi-menu.tsx). The host is told what the icon
 * knows (the theme, the language, whether the admin may use the assistant) and is kept for as long as an icon is on the screen.
 */
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => client }));

const allowed = { allowed: true, theme: lightTheme, locale: 'en' };
const hostElement = () => document.querySelector('[data-maison-assistant]');
const launcher = () => screen.findByRole('button', { name: 'Open the Maison assistant' });
const box = () => screen.getByRole('textbox', { name: 'Chat message' }) as HTMLTextAreaElement;

/** The CSS styled-components wrote for an element: every rule in the document that starts with one of its classes. */
const cssOf = (element: Element): string => {
  const all = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  const classes = Array.from(element.classList);
  return all
    .split('}')
    .filter((rule) => classes.some((name) => rule.trimStart().startsWith(`.${name}`)))
    .map((rule) => `${rule}}`)
    .join('\n');
};

beforeEach(() => {
  assistantWorld(client);
});
afterEach(() => {
  // The host is module state, so each test removes what it made. The clean-up of Testing Library goes first: it has no part in the host.
  cleanup();
  vi.useRealTimers();
  destroyHost();
  vi.unstubAllGlobals();
});

describe('the assistant host', () => {
  describe('what it draws', () => {
    it('is nothing in the page until it is told the admin may use the assistant: no element, however often it is told no', () => {
      attachHost();
      expect(hostElement()).toBeNull();
      act(() => updateHost({ ...allowed, allowed: false }));
      act(() => updateHost({ ...allowed, allowed: false }));
      expect(hostElement()).toBeNull();
      expect(document.body.children).toHaveLength(0);
    });

    it('draws the launcher in an element of its own, added to the body, when the admin may use the assistant', async () => {
      attachHost();
      act(() => updateHost(allowed));
      expect(await launcher()).toBeTruthy();
      expect(hostElement()?.parentElement).toBe(document.body);
      expect(hostElement()?.contains(await launcher())).toBe(true);
    });

    it('draws it once, however often it is told: it is one element and one launcher', async () => {
      attachHost();
      for (let round = 0; round < 4; round += 1) act(() => updateHost(allowed));
      await launcher();
      expect(document.querySelectorAll('[data-maison-assistant]')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Open the Maison assistant' })).toHaveLength(1);
    });

    it('draws it in the theme it is given, which is the theme of the admin', async () => {
      attachHost();
      act(() => updateHost(allowed));
      expect(cssOf(await launcher())).toMatch(new RegExp(`svg\\{[^}]*fill:${lightTheme.colors.neutral0};`));

      cleanup();
      destroyHost();
      attachHost();
      act(() => updateHost({ ...allowed, theme: darkTheme }));
      expect(cssOf(await launcher())).toMatch(new RegExp(`svg\\{[^}]*fill:${darkTheme.colors.neutral0};`));
    });

    it('follows a change of theme without making the chat again: what staff typed is still in the box', async () => {
      attachHost();
      act(() => updateHost(allowed));
      await userEvent.click(await launcher());
      await userEvent.type(await screen.findByRole('textbox', { name: 'Chat message' }), 'Which visits');

      act(() => updateHost({ ...allowed, theme: darkTheme }));

      expect(box().value).toBe('Which visits');
      expect(cssOf(screen.getByRole('complementary', { name: 'Maison assistant' }))).toContain(`background:${darkTheme.colors.neutral0};`);
    });

    it('removes the chat when the admin may no longer use the assistant, and draws a new one if they may again', async () => {
      attachHost();
      act(() => updateHost(allowed));
      await userEvent.click(await launcher());
      await userEvent.type(await screen.findByRole('textbox', { name: 'Chat message' }), 'Which visits');

      act(() => updateHost({ ...allowed, allowed: false }));
      expect(hostElement()).toBeNull();
      expect(screen.queryByRole('complementary')).toBeNull();

      act(() => updateHost(allowed));
      await userEvent.click(await launcher());
      expect((await screen.findByRole('textbox', { name: 'Chat message' })) as HTMLTextAreaElement).toHaveProperty('value', '');
    });
  });

  describe('how long it stays', () => {
    const present = async () => {
      attachHost();
      act(() => updateHost(allowed));
      await launcher();
    };

    it('stays for as long as an icon is on the screen', async () => {
      await present();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS * 10));
      expect(hostElement()).not.toBeNull();
    });

    it('is removed when the last icon has been gone for a short time, and not before: the admin has left, and the chat goes with them', async () => {
      await present();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      detachHost();
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS - 1));
      expect(hostElement()).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));

      expect(hostElement()).toBeNull();
      expect(document.body.children).toHaveLength(0);
    });

    // Strapi draws the icon again on every change of address: the old icon goes and the new one comes within the same moment.
    it('stays when an icon is drawn again within that time: the chat is the same chat', async () => {
      await present();
      await userEvent.click(await launcher());
      await userEvent.type(await screen.findByRole('textbox', { name: 'Chat message' }), 'Which visits');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      detachHost();
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS - 1));
      attachHost();
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS * 10));

      expect(hostElement()).not.toBeNull();
      expect(box().value).toBe('Which visits');
    });

    it('stays while any icon is left: two icons are on the screen, and one goes', async () => {
      attachHost();
      attachHost();
      act(() => updateHost(allowed));
      await launcher();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      detachHost();
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS * 10));
      expect(hostElement()).not.toBeNull();

      detachHost();
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS));
      expect(hostElement()).toBeNull();
    });

    it('does nothing when an icon that was never counted goes', () => {
      expect(() => detachHost()).not.toThrow();
      expect(hostElement()).toBeNull();
    });

    it('is a new chat when an icon comes after the host was removed: the next admin does not find the last one\'s chat', async () => {
      await present();
      await userEvent.click(await launcher());
      await userEvent.type(await screen.findByRole('textbox', { name: 'Chat message' }), 'A question the last admin was typing');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      detachHost();
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS));
      expect(hostElement()).toBeNull();
      vi.useRealTimers();

      await present();
      await userEvent.click(await launcher());

      expect((await screen.findByRole('textbox', { name: 'Chat message' })) as HTMLTextAreaElement).toHaveProperty('value', '');
    });

    it('is removed at once by destroyHost, and its timer with it, so a timer from an earlier host cannot remove the next', async () => {
      await present();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // This starts the timer that would remove the host.
      detachHost();

      act(() => destroyHost());
      expect(hostElement()).toBeNull();

      // The next host. The timer of the first would go off in the middle of its time, and would remove this one.
      attachHost();
      act(() => updateHost(allowed));
      act(() => vi.advanceTimersByTime(HOST_GRACE_MS * 2));
      expect(hostElement()).not.toBeNull();
    });
  });
});
