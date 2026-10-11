import * as React from 'react';

import { Launcher } from './Launcher';
import { Notice } from './BoundaryNotice';

/**
 * What the host's React root is wrapped in. React unmounts a whole root when something in it throws while drawing, and when a lazy chunk fails to
 * load (a network error, or a deploy that changed the file names under an open tab). Without this, the launcher would go with it and staff would
 * see nothing at all.
 *
 * After a failure the launcher stays. Pressing it shows a short fixed text instead of the chat, and the error goes to `console.error`, which is where
 * someone who looks for the cause will read it. The text is the same for every failure: staff cannot act on the cause, and the fix is a reload.
 * The boundary keeps the failure until the page is loaded again.
 */
export const ASSISTANT_FAILED_TEXT = 'The assistant could not load. Reload the page to try again.';

interface State {
  failed: boolean;
}

const FailedLauncher = () => {
  const [shown, setShown] = React.useState(false);
  return (
    <>
      <Launcher open={false} onOpen={() => setShown((value) => !value)} />
      {shown && <Notice>{ASSISTANT_FAILED_TEXT}</Notice>}
    </>
  );
};

export class AssistantBoundary extends React.Component<{ children?: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The Maison assistant failed to draw or to load.', error);
  }

  render() {
    return this.state.failed ? <FailedLauncher /> : this.props.children;
  }
}
