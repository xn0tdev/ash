import { Tool } from "../types";
import { sandboxFor, sandboxChanges } from "../../sandbox";

// Safe mode: instead of a standalone UI button, the agent proposes the merge
// itself when its work is done. This opens the review UI for the user (who
// approves the merge or discards). No-ops outside a safe-mode sandbox, and for
// background agents (which have no owner sandbox / no review callback).
export const proposeMergeTool: Tool = {
  name: "propose_merge",
  description:
    "SAFE MODE ONLY: once you've finished and verified the task, call this to show the user everything you changed in the sandbox and let them merge it into their real project (or discard). Call it exactly once, at the very end, then end your turn — the user makes the final call. Does nothing if you're not running in a safe-mode sandbox.",
  parameters: { type: "object", properties: {}, required: [] },
  async run(_args, ctx) {
    const info = ctx.ownerId ? sandboxFor(ctx.ownerId) : undefined;
    if (!info)
      return { ok: false, output: "Not running in a safe-mode sandbox — there is nothing to merge." };
    if (!ctx.reviewMerge)
      return { ok: false, output: "The merge review isn't available from here." };
    const changes = await sandboxChanges(ctx.ownerId!);
    if (!changes.length)
      return { ok: true, output: "The sandbox matches the project — no changes to merge." };

    ctx.reviewMerge();
    const preview = changes
      .slice(0, 25)
      .map((c) => `${c.status}: ${c.path}`)
      .join("\n");
    return {
      ok: true,
      output:
        `Presented ${changes.length} change(s) to the user to review and merge:\n${preview}` +
        `${changes.length > 25 ? `\n…and ${changes.length - 25} more` : ""}\n` +
        "The user will approve the merge or discard the sandbox. End your turn now — do not wait.",
    };
  },
};
