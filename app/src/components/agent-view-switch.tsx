import { COPY } from '../lib/copy';
import { useMaison } from './maison-provider';

/**
 * Turns the agent view on and off: the MCP calls behind the screen, in a drawer at the bottom (AgentDrawer). A real
 * switch, named by its words, with its state in aria-checked. The 44 px button holds a 32 px tag drawn like the
 * mockup's "MCP tools" button: hairline and mono, and ink while the view is on. There's one on each screen (Screen).
 */
export function AgentViewSwitch() {
  const { agentView, setAgentView, locale } = useMaison();
  return (
    <button type="button" role="switch" aria-checked={agentView} onClick={() => setAgentView(!agentView)} className="flex h-11 shrink-0 items-center">
      <span className={`flex h-8 items-center border px-3 font-mono text-[11px] ${agentView ? 'border-ink bg-ink text-paper' : 'border-hairline text-graphite'}`}>
        {COPY[locale].agentView}
      </span>
    </button>
  );
}
