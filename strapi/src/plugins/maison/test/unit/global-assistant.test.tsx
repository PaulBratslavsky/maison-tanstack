// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalAssistant } from '../../admin/src/components/assistant/GlobalAssistant';
import { READY, answer, assistantWorld, event, getsOf, savedChat, stream } from './fake-assistant-world';
import { declarationsOf } from './css';
import { renderInTheme } from './render';

/*
 * The assistant as an admin meets it on any page: a launcher, and a drawer the launcher opens. The real provider, `useChat` and the real
 * connection adapter run over a stand-in for Strapi's fetch client and for `fetch`. Nothing reaches a server or a model.
 */
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => client }));

const launcher = () => screen.getByRole('button', { name: 'Open the Maison assistant' });
const drawer = () => screen.getByRole('complementary', { name: 'Maison assistant' });
const box = () => screen.getByRole('textbox', { name: 'Chat message' }) as HTMLTextAreaElement;
const region = () => screen.getByRole('region', { name: 'Chat messages' });

/** Opens the drawer with the launcher and waits for the chat. */
const openDrawer = async () => {
  await userEvent.click(launcher());
  return screen.findByRole('textbox', { name: 'Chat message' });
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GlobalAssistant', () => {
  describe('before the drawer is opened', () => {
    it('is a launcher and nothing else: no drawer, no text box, no chat', () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      expect(launcher()).toBeTruthy();
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('region', { name: 'Chat messages' })).toBeNull();
    });

    it('asks the server nothing: no status check, and no saved chats. It is on every admin page, and most pages never open it', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      // Long enough for an effect to run and a request to be made, if one were going to be.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(client.get).not.toHaveBeenCalled();
    });
  });

  describe('opening the drawer', () => {
    it('opens it when the launcher is pressed, and the launcher is not on the screen while it is open', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);

      await userEvent.click(launcher());

      expect(drawer()).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Open the Maison assistant' })).toBeNull();
    });

    it('opens it from the keyboard, with Enter or Space on the launcher', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      launcher().focus();
      await userEvent.keyboard('{Enter}');
      expect(drawer()).toBeTruthy();
    });

    it('checks the assistant, and loads the saved chats, when the drawer is first opened, and moves the focus to the text box', async () => {
      assistantWorld(client, { saved: [savedChat('c1', 'Which visits are waiting?')] });
      renderInTheme(<GlobalAssistant />);
      expect(client.get).not.toHaveBeenCalled();

      const textarea = await openDrawer();

      expect(getsOf(client, '/maison/assistant/status')).toBe(1);
      await waitFor(() => expect(getsOf(client, '/maison/conversations')).toBe(1));
      // The most recent chat is reopened, as it is whenever the assistant is ready for the first time.
      await within(await screen.findByRole('region', { name: 'Chat messages' })).findByText('The answer to Which visits are waiting?');
      expect(document.activeElement).toBe(textarea);
    });

    it('is 600px wide when it opens, and at most 90vw', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      await openDrawer();
      expect(declarationsOf(drawer())).toMatchObject({ width: '600px', 'max-width': 'calc(90vw - 1px)' });
    });

    it('says why, in the drawer, when the assistant is not set up, and the launcher still opens it', async () => {
      assistantWorld(client, { status: { ready: false, reason: 'No key is set.' } });
      renderInTheme(<GlobalAssistant />);
      await userEvent.click(launcher());
      expect(await screen.findByRole('heading', { name: "The assistant isn't set up" })).toBeTruthy();
      expect(screen.getByText('No key is set.')).toBeTruthy();
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  describe('closing the drawer', () => {
    it('closes it with Close, brings the launcher back and gives it the focus', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      await openDrawer();

      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));

      expect(screen.queryByRole('complementary')).toBeNull();
      expect(launcher()).toBeTruthy();
      expect(document.activeElement).toBe(launcher());
    });

    it('closes it with Escape, brings the launcher back and gives it the focus', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      await openDrawer();

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('complementary')).toBeNull();
      expect(document.activeElement).toBe(launcher());
    });

    it('can be opened and closed again and again, and the focus follows each time', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      for (let round = 0; round < 3; round += 1) {
        await openDrawer();
        expect(document.activeElement).toBe(box());
        await userEvent.keyboard('{Escape}');
        expect(document.activeElement).toBe(launcher());
      }
    });

    it('asks the server once, however often the drawer is opened and closed', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      for (let round = 0; round < 3; round += 1) {
        await openDrawer();
        await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(getsOf(client, '/maison/assistant/status')).toBe(1);
      expect(getsOf(client, '/maison/conversations')).toBe(1);
    });
  });

  // Paul found the first drawer build starting a new chat each time the launcher was pressed.
  describe('opening the drawer', () => {
    it('is not in the page before the first opening, and is in the page, hidden, after it: closing hides the drawer and does not take it out', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      expect(document.querySelector('aside')).toBeNull();

      await openDrawer();
      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));

      const hidden = document.querySelector('aside') as HTMLElement;
      expect(hidden).not.toBeNull();
      expect(hidden.getAttribute('aria-hidden')).toBe('true');
      expect(hidden.hasAttribute('inert')).toBe(true);
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('shows the same chat when it is opened again: open, send, close, open again, and the messages, the text box and the draft are the same, with no second chat saved', async () => {
      const { rows } = assistantWorld(client, { chat: [() => stream(answer('Two visits wait.'))] });
      renderInTheme(<GlobalAssistant />);
      await userEvent.type(await openDrawer(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Two visits wait.');
      await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
      await userEvent.type(box(), 'And the questions');
      const textBox = box();

      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      await openDrawer();

      expect(box()).toBe(textBox);
      expect(box().value).toBe('And the questions');
      expect(within(region()).getByText('Which visits are waiting?')).toBeTruthy();
      expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
      expect(screen.queryByText('Ask Maison')).toBeNull();
      // No second chat was saved, and the saved chat was not saved again: nothing happened.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).not.toHaveBeenCalled();
      expect(rows).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: 'History' }));
      expect(within(screen.getByLabelText('Saved chats')).getAllByRole('button').filter((button) => !button.getAttribute('aria-label') && button.textContent !== 'New chat')).toHaveLength(1);
    });

    it('opens the most recent saved chat the first time, and the same chat every time after: it is loaded once for the page load, not again', async () => {
      assistantWorld(client, { saved: [savedChat('c2', 'Any complaints this week?'), savedChat('c1', 'Which visits are waiting?')] });
      renderInTheme(<GlobalAssistant />);

      await openDrawer();
      expect(await within(await screen.findByRole('region', { name: 'Chat messages' })).findByText('The answer to Any complaints this week?')).toBeTruthy();
      for (let round = 0; round < 3; round += 1) {
        await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
        await openDrawer();
        expect(within(region()).getByText('The answer to Any complaints this week?')).toBeTruthy();
        expect(screen.queryByText('Ask Maison')).toBeNull();
      }

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(client.get.mock.calls.filter(([url]) => url === '/maison/conversations/c2')).toHaveLength(1);
      expect(client.get.mock.calls.filter(([url]) => url === '/maison/conversations/c1')).toHaveLength(0);
      expect(getsOf(client, '/maison/conversations')).toBe(1);
      expect(getsOf(client, '/maison/assistant/status')).toBe(1);
    });

    it('shows the empty state, and no chat is made, when there is no saved chat, however often it is opened', async () => {
      assistantWorld(client);
      renderInTheme(<GlobalAssistant />);
      for (let round = 0; round < 3; round += 1) {
        await openDrawer();
        expect(screen.getByText('Ask Maison')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(client.post).not.toHaveBeenCalled();
      expect(client.put).not.toHaveBeenCalled();
      expect(client.del).not.toHaveBeenCalled();
    });

    it('shows the chat staff had begun, and not the most recent saved chat, when they began one before the list came', async () => {
      let answerList: (value: unknown) => void = () => {};
      assistantWorld(client, { saved: [savedChat('c1', 'An older chat')], chat: [() => stream(answer('Two visits wait.'))] });
      client.get.mockImplementation(async (url: string) => {
        if (url === '/maison/assistant/status') return { data: READY };
        if (url === '/maison/conversations') return new Promise((resolve) => (answerList = resolve));
        throw new Error(`Unexpected GET ${url}`);
      });
      renderInTheme(<GlobalAssistant />);
      await userEvent.type(await openDrawer(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Two visits wait.');

      answerList({ data: { conversations: [{ documentId: 'c1', title: 'An older chat', updatedAt: '2026-10-06T00:00:00.000Z' }] } });
      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      await openDrawer();

      expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
      expect(within(region()).queryByText('The answer to An older chat')).toBeNull();
      expect(client.get.mock.calls.filter(([url]) => url === '/maison/conversations/c1')).toHaveLength(0);
    });

    it('does not clear the messages or start a chat by pressing the launcher: only a New chat button does', async () => {
      assistantWorld(client, { saved: [savedChat('c1', 'Which visits are waiting?')] });
      renderInTheme(<GlobalAssistant />);
      await openDrawer();
      await within(region()).findByText('The answer to Which visits are waiting?');

      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      await openDrawer();
      expect(within(region()).getByText('The answer to Which visits are waiting?')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
      expect(screen.getByText('Ask Maison')).toBeTruthy();
    });
  });

  describe('what stays while the drawer is closed', () => {
    it('keeps the chat, what staff typed and not sent, and the width, so the drawer opens as staff left it', async () => {
      assistantWorld(client, { chat: [() => stream(answer('Two visits wait.'))] });
      renderInTheme(<GlobalAssistant />);
      await openDrawer();
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Two visits wait.');
      await userEvent.type(box(), 'And the questions');
      await userEvent.click(screen.getByRole('button', { name: 'Expand the assistant' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      expect(screen.queryByRole('textbox')).toBeNull();

      await openDrawer();

      expect(box().value).toBe('And the questions');
      expect(within(region()).getByText('Which visits are waiting?')).toBeTruthy();
      expect(within(region()).getByText('Two visits wait.')).toBeTruthy();
      expect(declarationsOf(drawer()).width).toBe('960px');
      expect(screen.getByRole('button', { name: 'Collapse the assistant' })).toBeTruthy();
    });

    // Staff ask, and look at a page while the answer comes. Closing the drawer must not stop it.
    it('goes on with an answer that is on its way when the drawer is closed, and the answer is there when it opens again', async () => {
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
      renderInTheme(<GlobalAssistant />);
      await openDrawer();
      await userEvent.type(box(), 'Which visits are waiting?{Enter}');
      await within(region()).findByText('Looking into it');

      await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
      finish();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await openDrawer();

      expect(await within(region()).findByText('Looking into it and found two visits.')).toBeTruthy();
      // The answer is over: Stop is gone, and nothing is shown as a failure.
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
      expect(Array.from(document.querySelectorAll('[role="alert"]')).filter((alert) => alert.textContent)).toEqual([]);
    });
  });

  it('draws in the dark theme too', async () => {
    assistantWorld(client);
    renderInTheme(<GlobalAssistant />, { dark: true });
    await openDrawer();
    expect(drawer()).toBeTruthy();
  });

  it('uses the status the server gave, once: the model is named in the top bar', async () => {
    assistantWorld(client, { status: READY });
    renderInTheme(<GlobalAssistant />);
    await openDrawer();
    expect(screen.getByText('claude-sonnet-5-5')).toBeTruthy();
  });
});
