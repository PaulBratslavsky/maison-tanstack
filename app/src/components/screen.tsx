import { useState, type ReactNode } from 'react';

import { COPY } from '../lib/copy';
import { errorText } from '../lib/status';
import { AgentDrawer } from './agent-drawer';
import { AgentViewSwitch } from './agent-view-switch';
import { ErrorNote } from './error-note';
import { Header, type BackLink } from './header';
import { useMaison } from './maison-provider';
import { McpToolsButton } from './mcp-tools-button';
import { OpenInLine } from './open-in-line';
import { Spinner } from './spinner';

/** The bottom bar (`bar`): a 48 px button with 12 px above and below it. */
const BAR_PADDING = 12;
const BAR_HEIGHT = 48 + 2 * BAR_PADDING;

/**
 * Every screen: header, the MCP tools it uses, sign-in state, and the agent view. In LINE mode outside the LINE app,
 * the "Open in LINE" page takes the screen's place, without the tools or the agent view: nothing is called from it, so
 * there's nothing to show and no switch to show it with. `back` names the screen's parent for the header's link, when
 * it's closer than the header's own guess (a product's collection).
 *
 * Under the header, one quiet line: the screen's MCP tools on the left, and on the right the agent view's switch, which
 * the header has no room for on a phone. On a page it scrolls away with the content; on a `fill` screen it stays. A screen
 * with a `title` (the concierge) gets a title bar there instead, as in the mockup: the title, the screen's one h1, and an
 * "N MCP tools" button whose panel lists the tools and holds the switch. Either way, one switch per screen.
 *
 * By default the page scrolls. `fill` is for a screen that scrolls inside itself with a bar pinned under it (the
 * concierge): it makes a column as tall as the whole screen, whose children are the column's flex items. The column runs
 * under the frame's own safe-area padding (`-mb`), so the bar keeps its own, as the agent view's drawer does. On the stage
 * laptop it is as tall as the phone frame.
 *
 * `bar` is a page's action pinned to the bottom of the screen (a product's "Book a visit"): white, under a hairline, with
 * the safe area's padding. With the agent view on, it sits on top of the drawer, so it stays in reach.
 */
export function Screen({
  name,
  tools,
  title,
  fill = false,
  back,
  bar,
  children,
}: {
  name: string;
  tools: string[];
  title?: string;
  fill?: boolean;
  back?: BackLink;
  bar?: ReactNode;
  children: ReactNode;
}) {
  const { status, signInError, openInLine, locale, agentView, retrySignIn } = useMaison();
  const t = COPY[locale];
  // With the agent view on, the screen ends the drawer's height lower, so the last rows of a page scroll clear of it, and
  // the pinned bar of a `fill` screen sits above it. A page adds a margin, and its bottom bar's height when it has one.
  // Without the drawer, a page's 8rem clears its bottom bar: 72 px and the safe area.
  const [drawerHeight, setDrawerHeight] = useState(0);
  const drawerOpen = agentView && drawerHeight > 0;
  const showBar = Boolean(bar) && status === 'ready';
  return (
    <div
      className={fill ? 'flex h-dvh flex-col -mb-[var(--line-safe-bottom)] stage:mb-0 stage:h-full' : 'pb-32'}
      style={
        drawerOpen
          ? { paddingBottom: fill ? `${drawerHeight}px` : `calc(${drawerHeight + (showBar ? BAR_HEIGHT : 0)}px + 2rem)` }
          : undefined
      }
    >
      <Header back={back} />
      {status !== 'open-in-line' && title && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-1">
          <h1 className="text-[15px] font-normal tracking-[0.04em]">{title}</h1>
          <McpToolsButton tools={tools} />
        </div>
      )}
      {status !== 'open-in-line' && !title && (
        <div className="flex h-11 shrink-0 items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center font-mono text-[11px] text-mist">
            <span aria-hidden="true" className="shrink-0 whitespace-pre">
              MCP ·{' '}
            </span>
            <ul aria-label="MCP tools" className="min-w-0 truncate">
              {tools.map((tool) => (
                <li key={tool} data-testid="tool-badge" className="inline before:content-['_·_'] first:before:content-none">
                  {tool}
                </li>
              ))}
            </ul>
          </div>
          <AgentViewSwitch />
        </div>
      )}
      {status === 'starting' && <Spinner label={t.signingIn} className="min-h-[50vh]" />}
      {status === 'error' && signInError && (
        <ErrorNote
          error={signInError}
          className="mx-5 my-10"
          action={
            <button type="button" onClick={retrySignIn} className="btn-text">
              {t.retry}
            </button>
          }
        >
          {t.signInFailed}: {errorText(signInError, locale)}
        </ErrorNote>
      )}
      {status === 'open-in-line' && openInLine && <OpenInLine url={openInLine.url} os={openInLine.os} />}
      {status === 'ready' && children}
      {showBar && (
        <div
          className="fixed inset-x-0 z-10 border-t border-hairline bg-paper px-[calc(1.25rem+var(--line-safe-x))] stage:absolute"
          // On the drawer, the drawer keeps the safe area; on its own, the bar does.
          style={
            drawerOpen
              ? { bottom: drawerHeight, paddingTop: BAR_PADDING, paddingBottom: BAR_PADDING }
              : { bottom: 0, paddingTop: BAR_PADDING, paddingBottom: `calc(${BAR_PADDING}px + var(--line-safe-bottom))` }
          }
        >
          {bar}
        </div>
      )}
      {status !== 'open-in-line' && <AgentDrawer screen={name} onHeight={setDrawerHeight} />}
    </div>
  );
}
