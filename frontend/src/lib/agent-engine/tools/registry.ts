import { Tool, ToolSchema } from "../types";
import { readFileTool } from "./read-file";
import { writeFileTool } from "./write-file";
import { editFileTool } from "./edit-file";
import { bashTool } from "./bash";
import { bashBackgroundTool, bashBackgroundKillTool } from "./bash-background";
import { bgAgentTool, stopAgentTool } from "./agent-bg";
import { readTerminalTool, terminalInputTool, waitForTerminalTool } from "./terminal-io";
import { skillTool } from "./skill";
import { grepTool } from "./grep";
import { globTool } from "./glob";
import { webFetchTool } from "./web-fetch";
import { proposeMergeTool } from "./merge";
import { runWorkflowTool, spawnAgentsTool } from "./workflow";

export const TOOLS: Tool[] = [
  readFileTool,
  editFileTool,
  writeFileTool,
  bashTool,
  bashBackgroundTool,
  bashBackgroundKillTool,
  bgAgentTool,
  stopAgentTool,
  readTerminalTool,
  terminalInputTool,
  waitForTerminalTool,
  grepTool,
  globTool,
  webFetchTool,
  skillTool,
  proposeMergeTool,
  runWorkflowTool,
  spawnAgentsTool,
];

const byName = new Map<string, Tool>(TOOLS.map((t) => [t.name, t]));
const schemas: ToolSchema[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

export function getTool(name: string): Tool | undefined {
  return byName.get(name);
}

/** Tool schemas advertised to the model. With `allowed`, only those tools are
 * exposed (role scoping) — a reviewer never even sees edit_file/bash. */
export function toolSchemas(allowed?: string[]): ToolSchema[] {
  if (!allowed) return schemas;
  const set = new Set(allowed);
  return schemas.filter((s) => set.has(s.name));
}
