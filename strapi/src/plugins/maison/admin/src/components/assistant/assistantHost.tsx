import { DesignSystemProvider } from '@strapi/design-system';
import { Suspense, lazy } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DefaultTheme } from 'styled-components';

import { AssistantBoundary } from './AssistantBoundary';

/**
 * The assistant's host: the one place on the screen where the assistant is kept, in a React root of its own, in an element added to the body.
 *
 * Why it is not in the menu icon. Strapi has no place for something that is on every admin page, but it draws every menu link's icon on every
 * signed-in page (`LeftMenu` and `MainNavLinks` in @strapi/admin 5.57.0), so Maison's menu icon is how the assistant gets onto every page. But
 * Strapi draws the icon again on every change of address: `LeftMenu` reads the location, and `MainNavIcons` makes a new component type for each
 * link on every render, so React removes the old icon and draws a new one. Anything the icon held, the chat among it, would be lost at
 * each click on a menu link, and at each change of tab on the Maison page. And an answer on its way would be stopped.
 *
 * So the icon holds nothing. It tells the host what Strapi's providers say and the host cannot read (the theme, the language and whether the
 * admin may use the assistant), and it keeps the host in place for as long as an icon is on the screen. The host's own React root has no
 * Strapi provider, which the chat does not need: it reads the theme and the language from what the icon tells it, and it calls the server with
 * `useFetchClient`, which does not read a provider. When no icon has been drawn for a short time, the admin has left the signed-in pages
 * (they signed out), and the host removes the assistant and its chat.
 *
 * A failure inside the host, while drawing or while loading the chunk, would unmount the whole root and take the launcher with it. The root is
 * inside an error boundary (AssistantBoundary.tsx) that keeps the launcher and shows a short fixed text instead.
 *
 * The chat is loaded when it is needed. Its code (the Markdown, TanStack AI and the rest) is a chunk of its own, loaded the first time an admin
 * who may use the assistant is on a page, and not in the admin's first bundle for everyone.
 */

/** What the menu icon knows from Strapi's providers, and tells the host. */
export interface HostEnvironment {
  /** Whether the admin may use the assistant. With false the host draws nothing. */
  allowed: boolean;
  theme: DefaultTheme;
  locale: string;
}

const GlobalAssistant = lazy(() => import('./GlobalAssistant').then((module) => ({ default: module.GlobalAssistant })));

/**
 * How long the host stays after the last icon has gone, in milliseconds. Strapi's icon goes and a new one comes within the same moment, so any
 * time longer than that keeps the chat across a change of page. It is short, because an admin who has signed out must not leave a chat behind.
 */
export const HOST_GRACE_MS = 500;

let container: HTMLElement | null = null;
let root: Root | null = null;
let environment: HostEnvironment | null = null;
/** How many icons are on the screen and have attached. */
let attached = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const stopTimer = () => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
};

/**
 * Draws what the environment says, in the host's root. The root is made the first time an admin who may use the assistant is told, and the
 * same root is drawn into after that, so a change of theme or of language changes the chat in place, and what staff typed stays.
 *
 * When the admin may not use the assistant, the root draws nothing and its element leaves the page. It does not unmount the root here: this
 * runs inside the menu icon's effects, which are inside React's commit, where a root must not be unmounted.
 */
const draw = () => {
  if (!environment?.allowed) {
    root?.render(null);
    container?.remove();
    return;
  }
  if (!root || !container) {
    container = document.createElement('div');
    container.setAttribute('data-maison-assistant', '');
    root = createRoot(container);
  }
  if (!container.isConnected) document.body.appendChild(container);
  root.render(
    <DesignSystemProvider theme={environment.theme} locale={environment.locale}>
      <AssistantBoundary>
        <Suspense fallback={null}>
          <GlobalAssistant />
        </Suspense>
      </AssistantBoundary>
    </DesignSystemProvider>
  );
};

/** What the owning icon tells the host: each time the theme, the language or the permission changes. */
export const updateHost = (next: HostEnvironment): void => {
  environment = next;
  draw();
};

/** An icon that looks after the assistant is on the screen. The host stays for as long as one is. */
export const attachHost = (): void => {
  attached += 1;
  stopTimer();
};

/** An icon that looked after the assistant has left. When it was the last, the host goes after HOST_GRACE_MS, unless an icon attaches first. */
export const detachHost = (): void => {
  if (attached === 0) return;
  attached -= 1;
  if (attached > 0 || timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    destroyHost();
  }, HOST_GRACE_MS);
};

/** Removes the assistant and its chat now, and clears everything. The next icon starts a new chat. */
export const destroyHost = (): void => {
  stopTimer();
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  environment = null;
  attached = 0;
};
