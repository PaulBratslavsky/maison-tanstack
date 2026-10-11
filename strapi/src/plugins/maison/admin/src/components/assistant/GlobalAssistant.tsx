import * as React from 'react';

import { AssistantProvider } from './AssistantProvider';
import { ChatDrawer } from './ChatDrawer';
import { Launcher } from './Launcher';

/**
 * The assistant as an admin meets it on any page: a launcher at the bottom right, and the drawer it opens. It is rendered by the assistant's host
 * (assistantHost.tsx), once, for an admin who may use the assistant, and stays while the admin moves between pages.
 *
 * - The provider is above the launcher and the drawer, so the chat, its saved chats and the draft are as staff left them when the drawer is closed
 *   and opened again. Closing the drawer does not stop an answer that is on its way.
 * - The drawer is drawn when it is first opened, and stays in the page from then on: closing hides it (see ChatDrawer). Opening it again shows the same
 *   screen, with the same messages, the same text box and the same scroll. Opening never starts a chat, never saves one and never clears the messages:
 *   only the New chat buttons start a chat. The first opening checks the assistant and reopens the most recent saved chat, once for the page load, in the provider.
 * - The provider asks the server nothing until the drawer has been opened once (`started`). This is on every admin page, and most pages never open it.
 * - The drawer's width is kept here, so it opens as wide as staff left it. Closing gives the focus back to the launcher.
 */
export const GlobalAssistant = () => {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const launcher = React.useRef<HTMLButtonElement>(null);
  // Set when staff close the drawer, and used once the launcher is on the screen again.
  const returnsFocus = React.useRef(false);

  React.useEffect(() => {
    if (open || !returnsFocus.current) return;
    returnsFocus.current = false;
    launcher.current?.focus();
  }, [open]);

  return (
    <AssistantProvider started={started}>
      <Launcher
        ref={launcher}
        open={open}
        onOpen={() => {
          setStarted(true);
          setOpen(true);
        }}
      />
      {started && (
        <ChatDrawer
          open={open}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((value) => !value)}
          onClose={() => {
            returnsFocus.current = true;
            setOpen(false);
          }}
        />
      )}
    </AssistantProvider>
  );
};
