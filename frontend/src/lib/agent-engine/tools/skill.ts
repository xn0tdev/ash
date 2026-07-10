import { Tool } from "../types";
import { discoverSkills, loadSkill } from "../skills";

// Guards the OpenCode failure mode: a model invoking the same skill over and
// over for hours. Once a skill is loaded for a pane, repeats get a short
// reminder instead of the full body. Keyed per agent pane, session-lifetime.
const loaded = new Map<string, Set<string>>();

export const skillTool: Tool = {
  name: "skill",
  description:
    "Load a skill — reusable instructions for a specific kind of task (the available skills are listed in your system prompt). Invoke a skill AT MOST ONCE, then follow its instructions; never re-invoke one that is already loaded.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The skill's name, exactly as listed" },
    },
    required: ["name"],
  },
  async run(args, ctx) {
    const name = String(args.name ?? "").trim();
    const owner = ctx.ownerId ?? "engine";

    const already = loaded.get(owner);
    if (already?.has(name.toLowerCase()))
      return {
        ok: false,
        output: `Skill "${name}" is ALREADY loaded in this conversation — do not invoke it again. Follow its instructions and continue with the task.`,
      };

    const skill = await loadSkill(ctx.cwd, name);
    if (!skill) {
      const available = (await discoverSkills(ctx.cwd)).map((s) => s.name).join(", ") || "none";
      return { ok: false, output: `No skill named "${name}". Available skills: ${available}.` };
    }

    if (!already) loaded.set(owner, new Set());
    loaded.get(owner)!.add(name.toLowerCase());

    return {
      ok: true,
      output: `Skill "${skill.meta.name}" loaded (base directory: ${skill.meta.dir} — relative paths in the skill resolve there):\n\n${skill.content}`,
    };
  },
};
