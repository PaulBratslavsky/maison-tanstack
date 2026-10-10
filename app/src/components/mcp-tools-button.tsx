import { useEffect, useId, useRef, useState } from 'react';

import { shouldCloseOnKey } from '../lib/booking';
import { COPY } from '../lib/copy';
import { AgentViewSwitch } from './agent-view-switch';
import { useMaison } from './maison-provider';

/**
 * A title bar's "N MCP tools" button (the concierge's, in the mockup), drawn like the agent view's switch: a 44 px
 * button around a 32 px hairline tag in mono. It opens a small panel under it: the screen's tools in mono, and the agent
 * view's switch, which a screen with a title bar has nowhere else. The panel closes on the button, on Escape, and on a tap
 * outside it.
 */
export function McpToolsButton({ tools }: { tools: string[] }) {
  const { locale } = useMaison();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (shouldCloseOnKey(event)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)} className="flex h-11 items-center">
        <span className={`flex h-8 items-center border px-3 font-mono text-[11px] ${open ? 'border-ink text-ink' : 'border-hairline text-graphite'}`}>
          {COPY[locale].mcpTools(tools.length)}
        </span>
      </button>
      <div id={panel} hidden={!open} className="absolute right-0 top-full z-20 mt-1 w-60 border border-ink bg-paper px-4 pt-3">
        <p className="font-mono text-[11px] text-mist">MCP · Strapi /mcp</p>
        <ul aria-label="MCP tools" className="mt-2 flex flex-col gap-1.5 pb-2 font-mono text-[11px] text-ink">
          {tools.map((tool) => (
            <li key={tool} data-testid="tool-badge">
              {tool}
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t border-hairline">
          <AgentViewSwitch />
        </div>
      </div>
    </div>
  );
}
