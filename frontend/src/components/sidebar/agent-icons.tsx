// TODO(future): per-agent brand icons. This module is currently NOT imported
// anywhere — the tab-row brand avatars were dropped from the sidebar while the
// CLI-agent detection logic (lib/agent-detect.ts) was kept. When a future
// feature wants to badge a terminal that's running claude / antigravity /
// opencode / pi again, re-add the import in Sidebar.tsx and these components
// will light back up as-is.
//
// Brand logos for detected CLI agents, imported as URL strings (Vite serves
// the raw .svg). Unlike the inline sidebar icons these keep their original
// brand colors — recognition matters more than theme-matching for a logo.
import claudeIcon from "../../assets/agents/claude.svg";
import antigravityIcon from "../../assets/agents/antigravity.svg";
import opencodeIcon from "../../assets/agents/opencode.svg";
import piIcon from "../../assets/agents/pi.svg";

const ICONS: Record<string, string> = {
  claude: claudeIcon,
  antigravity: antigravityIcon,
  opencode: opencodeIcon,
  pi: piIcon,
};

/** A brand logo for a detected agent id, or null if we have no icon for it. */
export function agentBrandIcon(id: string): string | null {
  return ICONS[id] ?? null;
}

/** Inline <img> for a detected agent id. Returns null when no logo exists so
 *  callers can fall back to the default terminal icon. */
export function AgentBrandIcon({ id }: { id: string }) {
  const src = agentBrandIcon(id);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      // Brand SVGs have their own viewBox; render at the sidebar icon size.
      width={16}
      height={16}
      style={{ flex: "none", display: "block" }}
    />
  );
}

/** A small rounded chip holding one agent's brand logo — the building block
 *  for the single and paired agent icons. `size` is the chip edge; the logo
 *  fill ratio is per-agent because the source SVGs differ — Claude and
 *  Antigravity are tight 24×24 marks, while OpenCode's is a tall 240×300 with
 *  lots of negative space, so it needs a much larger ratio to read at the
 *  same visual weight. */
// Per-agent logo fill ratio inside the disc. Claude and Antigravity ship as
// tight 24×24 marks that fill the chip well at ~64%. OpenCode's source SVG is
// a tall 240×300 portrait with a lot of negative space — at the same ratio it
// reads visually LARGER than the others, so it gets a smaller ratio to match
// their perceived weight. Pi's mark is an 800×800 P+i glyph with a countersunk
// hole, dense enough to sit at ~66%.
const LOGO_RATIO: Record<string, number> = {
  claude: 0.64,
  antigravity: 0.64,
  opencode: 0.5,
  pi: 0.66,
};

function BrandChip({ id, size, className }: { id: string; size: number; className?: string }) {
  const src = agentBrandIcon(id);
  const ratio = LOGO_RATIO[id] ?? 0.66;
  return (
    <span
      className={`agent-chip${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    >
      {src && <img src={src} alt="" width={Math.round(size * ratio)} height={Math.round(size * ratio)} />}
    </span>
  );
}

/** One detected agent in a single-terminal tab → its logo on a chip. Keeps the
 *  brand colors readable against the sidebar. `size` defaults to the tab-row
 *  size; pass a smaller one for sub-rows (the expanded agent list). */
export function AgentSingleIcon({ id, size = 26 }: { id: string; size?: number }) {
  return <BrandChip id={id} size={size} />;
}

/** Two or more detected agents in a split tab → a minimal avatar stack.
 *  Same-size discs overlap ~30% so every logo stays visible; each disc paints
 *  over the previous (solid fill = clean seam, no ring). More than 4 agents
 *  would crowd the slot, so cap at 4 — beyond that the title already lists
 *  them. Agents render in leaf order so the left pane's agent is leftmost. */
export function AgentPairIcon({ ids }: { ids: string[] }) {
  const shown = ids.slice(0, 4);
  if (shown.length === 1) return <AgentSingleIcon id={shown[0]} />;
  // Shrink slightly as the stack grows so 3–4 discs still fit the icon slot.
  const size = shown.length >= 3 ? 16 : 19;
  return (
    <span className="agent-pair">
      {shown.map((id, i) => (
        <BrandChip key={id} id={id} size={size} className={i === 0 ? "first" : "stacked"} />
      ))}
    </span>
  );
}
